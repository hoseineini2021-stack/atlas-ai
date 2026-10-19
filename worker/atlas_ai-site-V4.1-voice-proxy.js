/**
 * AI Chat — Cloudflare Worker
 * - چهار مدل قابل انتخاب: Ai-2 / Ai-3 / Star-1 / Star-2 (فرمت OpenAI: chat/completions)
 * - بدون هیچ system prompt
 * - لاگین با گوگل (Google Identity Services - Sign in with Google)
 * - ذخیره چت‌ها روی Storage API خارجی (api-at-by.byternet.js) از طریق پروکسی داخل همین Worker
 *
 * ENV VARS مورد نیاز (در wrangler.toml یا Cloudflare Dashboard تنظیم کن):
 *   GOOGLE_CLIENT_ID      -> Client ID اپلیکیشن گوگل شما
 *   STORAGE_API_URL       -> آدرس Worker ذخیره‌سازی (مثلا https://xxxx.workers.dev)
 *   STORAGE_API_KEY       -> API Key همون Storage Worker (X-API-Key)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // صفحه اصلی + مسیرهای چت (SPA) — همه یک HTML برمی‌گردونن، مسیریابی سمت کلاینت انجام می‌شه
      if (path === '/' || path === '/index.html' || path.startsWith('/a/chat/s/')) {
        return new Response(renderHTML(env), {
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        });
      }

      // صفحه‌ی مستندات/دریافت کلید API — مثل صفحه‌های API سایت‌های معروف (Stripe/OpenAI و…)
      if (path === '/api' || path === '/api/') {
        return new Response(renderApiDocsPage(env), {
          headers: { 'Content-Type': 'text/html; charset=UTF-8' },
        });
      }

      // اطلاعات پیکربندی عمومی برای فرانت‌اند (بدون کلیدهای محرمانه)
      if (path === '/config' && request.method === 'GET') {
        return jsonResponse({
          googleClientId: env.GOOGLE_CLIENT_ID || '',
          models: {
            ai2:   { configured: !!(env.AI2_BASE_URL && env.AI2_MODEL) },
            ai3:   { configured: !!(env.AI3_BASE_URL && env.AI3_MODEL) },
            star1: { configured: !!(env.STAR1_BASE_URL && env.STAR1_MODEL) },
            star2: { configured: !!(env.STAR2_BASE_URL && env.STAR2_MODEL) },
          },
        });
      }

      // --- پروکسی به Storage API خارجی، تا کلید Storage هیچ وقت توی مرورگر کاربر دیده نشه ---
      if (path === '/storage/chat/create' && request.method === 'POST') {
        return await proxyToStorage(env, '/chat/create', 'POST', await request.text());
      }
      if (path.startsWith('/storage/chat/') && path.endsWith('/message') && request.method === 'POST') {
        const id = path.split('/')[3];
        return await proxyToStorage(env, `/chat/${id}/message`, 'POST', await request.text());
      }
      if (path.startsWith('/storage/chat/') && path.endsWith('/attachments') && request.method === 'POST') {
        const id = path.split('/')[3];
        return await proxyToStorage(env, `/chat/${id}/attachments`, 'POST', await request.text());
      }
      if (path.startsWith('/storage/chat/') && request.method === 'GET') {
        const id = path.split('/')[3];
        return await proxyToStorage(env, `/chat/${id}`, 'GET');
      }
      if (path === '/storage/list' && request.method === 'GET') {
        return await proxyToStorage(env, `/list${url.search}`, 'GET');
      }
      if (path.startsWith('/storage/chat/') && request.method === 'DELETE') {
        const id = path.split('/')[3];
        return await proxyToStorage(env, `/chat/${id}`, 'DELETE');
      }

      // --- آپلود فایل/عکس کاربر به Storage API (پروکسی می‌شود تا کلید Storage در مرورگر دیده نشود) ---
      if (path === '/storage/upload' && request.method === 'POST') {
        return await proxyUpload(env, await request.formData());
      }
      if (path.startsWith('/storage/download/') && request.method === 'GET') {
        const id = path.split('/')[3];
        return await proxyDownload(env, id);
      }

      // --- پروکسی چت با هوش مصنوعی (فرمت OpenAI chat/completions)، بدون هیچ system prompt ---
      if (path === '/ai/chat' && request.method === 'POST') {
        return await handleAiChat(request, env);
      }

      // --- API عمومی سازگار با OpenAI (کلید API واقعی لازم داره؛ همون کلیدهایی که از ربات تلگرام صادر میشن) ---
      // این مسیر مستقیماً به سرور پایتون (atlas_bot.py روی PythonAnywhere) پروکسی میشه، تا هم
      // https://atlas.synapt.workers.dev/v1/chat/completions و هم
      // https://byternet.eu.pythonanywhere.com/v1/chat/completions هر دو معتبر و قابل استفاده باشن.
      // --- گفتگوی صوتی زنده از سایت: صوت کاربر -> سرور بات (STT + AI + TTS) ---
      if (path === '/voice/chat' && request.method === 'POST') {
        return await handleVoiceChat(request, env);
      }

      // --- (v1.5) صدا برای اپ اندروید: multipart را با کلید خودِ کاربر به سرور بات پاس می‌دهد ---
      if (path === '/v1/voice/chat' && request.method === 'POST') {
        return await proxyVoiceToBotServer(env, request);
      }

      if ((path === '/v1/chat/completions' || path === '/v1/models') && (request.method === 'POST' || request.method === 'GET')) {
        return await proxyToBotServer(env, path, request);
      }

      return errorResponse('Not found', 404);
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse(`Internal error: ${err.message}`, 500);
    }
  },
};

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function proxyToStorage(env, path, method, body) {
  if (!env.STORAGE_API_URL || !env.STORAGE_API_KEY) {
    return errorResponse('Storage API not configured on server', 500);
  }
  const sep = path.includes('?') ? '&' : '?';
  const target = `${env.STORAGE_API_URL}${path}${sep}api_key=${encodeURIComponent(env.STORAGE_API_KEY)}`;
  const res = await fetch(target, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body || undefined,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function proxyUpload(env, formData) {
  if (!env.STORAGE_API_URL || !env.STORAGE_API_KEY) {
    return errorResponse('Storage API not configured on server', 500);
  }
  const target = `${env.STORAGE_API_URL}/upload?api_key=${encodeURIComponent(env.STORAGE_API_KEY)}`;
  const res = await fetch(target, { method: 'POST', body: formData });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function proxyDownload(env, id) {
  if (!env.STORAGE_API_URL || !env.STORAGE_API_KEY) {
    return errorResponse('Storage API not configured on server', 500);
  }
  const target = `${env.STORAGE_API_URL}/download/${encodeURIComponent(id)}?api_key=${encodeURIComponent(env.STORAGE_API_KEY)}`;
  const res = await fetch(target);
  const headers = new Headers(res.headers);
  Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(res.body, { status: res.status, headers });
}

/**
 * کلیدها و تنظیمات مدل‌ها از env (Variables & Secrets در Cloudflare) خونده می‌شه.
 * فرانت فقط نام مدل (ai2/ai3/star1) و پیام‌ها رو می‌فرسته.
 * هیچ system prompt‌ای اضافه نمی‌شود.
 */
// پروکسی مسیرهای عمومی API سازگار با OpenAI (/v1/chat/completions و /v1/models) مستقیماً به
// سرور بات (atlas_bot.py روی PythonAnywhere). این مسیر برای فراخوانی‌کنندگان خارجی (کسانی که
// از ربات تلگرام کلید API گرفته‌اند) استفاده می‌شه — نه برای چت داخل خودِ سایت (که از /ai/chat
// با احراز هویت گوگل استفاده می‌کنه). درخواست و پاسخ (شامل استریم SSE) عیناً pass-through میشه؛
// هدر Authorization کاربر (کلید API خودش، نه کلید داخلی سایت) هم دست‌نخورده پاس داده میشه.
async function proxyToBotServer(env, path, request) {
  const botServerBaseUrl = (env.BOT_SERVER_BASE_URL || 'https://byternet.eu.pythonanywhere.com').trim();
  const endpoint = botServerBaseUrl.replace(/\/+$/, '') + path;

  const upstreamHeaders = { 'Content-Type': 'application/json' };
  const authHeader = request.headers.get('Authorization');
  if (authHeader) upstreamHeaders['Authorization'] = authHeader;

  const init = { method: request.method, headers: upstreamHeaders };
  if (request.method === 'POST') {
    init.body = await request.text();
  }

  // تایم‌اوت سمت Worker: کمی بیشتر از سقف تایم‌اوت دینامیک پایتون (۲۸۰ ثانیه) تا
  // برای درخواست‌های سنگین (مثلاً کدهای طولانی از OpenCode) این Worker خودش زودتر
  // از atlas_bot.py درخواست را قطع نکند. اگر واقعاً قطع شد، پیام خطای شفاف
  // برمی‌گردانیم به‌جای این‌که کلاینت یک اتصال بسته/خالی ببیند.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 300s
  init.signal = controller.signal;

  let upstreamRes;
  try {
    upstreamRes = await fetch(endpoint, init);
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err && (err.name === 'AbortError');
    return errorResponse(
      isAbort
        ? 'تایم‌اوت: سرور مدل ظرف 300 ثانیه پاسخ نداد.'
        : `خطا در ارتباط با سرور مدل: ${err.message}`,
      isAbort ? 504 : 502
    );
  }
  clearTimeout(timeoutId);

  const upstreamContentType = upstreamRes.headers.get('Content-Type') || '';

  // اگه واقعاً استریم SSE بود، عیناً pass-through کن (بدون بافر کردن کل پاسخ)
  if (upstreamContentType.indexOf('text/event-stream') !== -1 && upstreamRes.body) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: { 'Content-Type': upstreamContentType, ...CORS_HEADERS },
    });
  }

  const text = await upstreamRes.text();
  return new Response(text, {
    status: upstreamRes.status,
    headers: { 'Content-Type': upstreamContentType || 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

// (v1.5) /v1/voice/chat — مخصوص اپ اندروید. فرم multipart (audio, model, lang, history) را
// دست‌نخورده و با هدر Authorization خودِ کاربر به سرور بات می‌فرستد (JSON نیست، پس از
// proxyToBotServer استفاده نمی‌شود چون آن متن را می‌خواند و Content-Type را JSON می‌گذارد).
async function proxyVoiceToBotServer(env, request) {
  const auth = request.headers.get('Authorization');
  if (!auth) return errorResponse('Missing Authorization header', 401);
  const base = (env.BOT_SERVER_BASE_URL || 'https://byternet.eu.pythonanywhere.com').trim().replace(/\/+$/, '');
  let form;
  try { form = await request.formData(); } catch { return errorResponse('Invalid form data', 400); }
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(base + '/v1/voice/chat', {
      method: 'POST', headers: { 'Authorization': auth }, body: form, signal: controller.signal,
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS } });
  } catch (err) {
    return errorResponse(err && err.name === 'AbortError' ? 'Voice timeout' : 'Voice upstream error: ' + err.message, 504);
  } finally { clearTimeout(tid); }
}

async function handleVoiceChat(request, env) {
  const apiKey = env.BOT_SERVER_API_KEY || '';
  if (!apiKey) return errorResponse('BOT_SERVER_API_KEY is not configured on the server.', 503);
  const base = (env.BOT_SERVER_BASE_URL || 'https://byternet.eu.pythonanywhere.com').trim().replace(/\/+$/, '');
  let form;
  try { form = await request.formData(); } catch { return errorResponse('Invalid form data', 400); }
  const modelKey = form.get('modelKey');
  const MAP = { ai2: 'Ai-2', ai3: 'Ai-3', star1: 'STAR-1', star2: 'STAR-1' };
  form.delete('modelKey');
  form.set('model', MAP[modelKey] || 'Ai-2');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(base + '/v1/voice/chat', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey }, body: form, signal: controller.signal,
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS } });
  } catch (err) {
    return errorResponse(err && err.name === 'AbortError' ? 'Voice timeout' : 'Voice upstream error: ' + err.message, 504);
  } finally { clearTimeout(tid); }
}

async function handleAiChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { modelKey, messages, stream, ThinkAtlas, webSearch } = body;
  if (!modelKey || !Array.isArray(messages)) {
    return errorResponse('Missing modelKey or messages', 400);
  }

  // نگاشت نام مدل داخل UI سایت (ai2/ai3/star1) به نام واقعی مدل که سرور بات/ربات
  // (atlas_bot.py روی byternet.eu.pythonanywhere.com) انتظارش رو داره
  const MODEL_NAME_MAP = { ai2: 'Ai-2', ai3: 'Ai-3', star1: 'STAR-1', star2: 'STAR-2' };
  const realModelName = MODEL_NAME_MAP[modelKey];
  if (!realModelName) {
    return errorResponse(`Unknown model "${modelKey}"`, 400);
  }

  // این Worker (atlas.synapt.workers.dev) خودش رابط کاربریِ سایته؛ کاربر همیشه با همین
  // آدرس کار می‌کنه. اما پشتِ‌صحنه، درخواست واقعی مدل مستقیماً به سرور بات (که خودش
  // atlas_bot.py رو اجرا می‌کنه) فرستاده می‌شه — نه به یک پروکسی واسط سوم — چون همون
  // سرور خودش منطق انتخاب/failover/استریم مدل‌ها رو به‌طور کامل پیاده‌سازی کرده.
  const BOT_SERVER_BASE_URL = (env.BOT_SERVER_BASE_URL || 'https://byternet.eu.pythonanywhere.com').trim();
  const endpoint = BOT_SERVER_BASE_URL.replace(/\/+$/, '') + '/v1/chat/completions';

  // کلید API که این Worker برای احراز هویت به سرور بات استفاده می‌کنه (یک کلید ADMIN/داخلی
  // که هیچ‌وقت به مرورگر کاربر فرستاده نمی‌شه، و مشمول محدودیت هفتگی ۵۰۰ درخواست نیست
  // چون owner_chat_id این کلید باید متعلق به ادمین یا NULL باشه — طبق منطق atlas_bot.py)
  const apiKey = env.BOT_SERVER_API_KEY || '';
  if (!apiKey) {
    return errorResponse('BOT_SERVER_API_KEY is not configured on the server. Set it in Cloudflare Variables & Secrets.', 503);
  }

  const upstreamHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const SITE_FORMAT_PROMPT = 'Site formatting rules: (1) You may use markdown tables (| a | b | with a |---|---| separator row) and markdown links [text](https://url) when useful; the site renders them. (2) When the user asks you to EDIT or FIX code that already exists in this chat (an attached file or code you wrote earlier), do NOT rewrite the whole file. Reply with a short explanation, then for each change output a fenced code block (use the file language) containing one or more blocks exactly in this form:\n<<<<<<< SEARCH\n(exact existing lines to replace, copied verbatim, enough lines to be unique)\n=======\n(new lines)\n>>>>>>> REPLACE\nTo insert, SEARCH the line before the insertion point and include it again in REPLACE. To delete, leave the REPLACE part empty. Order: first the explanation of what you are changing and why, then the SEARCH/REPLACE blocks. Never invent SEARCH text: copy it character for character from the file. The site applies these blocks to the original file and gives the user the full patched file with a download button, so do not paste the whole file yourself unless the user explicitly asks for it or the file is new.';
  const upstreamMessages = [{ role: 'system', content: SITE_FORMAT_PROMPT }].concat(messages);

  const upstreamBody = {
    model: realModelName,
    messages: upstreamMessages, // فقط پیام‌های user/assistant — هیچ system prompt‌ای اضافه نمی‌شود (سرور بات خودش پرامپت سیستمی رو اضافه می‌کنه)
    stream: !!stream,
    web_search: !!webSearch, // گزینه‌ی «جستجوی هوشمند» در سایت؛ سرور بالادستی خودش تشخیص AI-محور می‌ده که واقعا لازمه یا نه
    ThinkAtlas: realModelName === 'STAR-2' ? ThinkAtlas !== false : false,
  };

  const upstreamRes = await fetch(endpoint, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify(upstreamBody),
  });

  // فقط وقتی واقعاً پاسخ SSE هست پاسش بده؛ اگر کلاینت stream خواسته بود ولی سرور بالادستی
  // (مثلاً مسیر Vision که استریم رو پشتیبانی نمی‌کنه) JSON عادی برگردونده، نباید به‌عنوان
  // event-stream پاس داده بشه — وگرنه پارسر SSE سمت کلاینت متن رو به‌شکل خراب/بی‌معنی می‌خونه.
  const upstreamContentType = upstreamRes.headers.get('Content-Type') || '';
  const upstreamIsSSE = upstreamContentType.indexOf('text/event-stream') !== -1;

  if (stream && upstreamIsSSE && upstreamRes.body) {
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        'Content-Type': upstreamContentType,
        ...CORS_HEADERS,
      },
    });
  }

  // upstream JSON عادی برگردونده (چه چون stream نخواسته بودیم، چه چون سرور بالادستی
  // (مثلاً مسیر Vision) با وجود stream:true باز هم JSON داده) — همینو مستقیم به کلاینت بده
  // تا سمت جاوااسکریپت با extractReply/JSON.parse درست خونده بشه، نه با پارسر SSE.
  const text = await upstreamRes.text();
  return new Response(text, {
    status: upstreamRes.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function renderHTML(env) {
  return HTML_PAGE;
}

function renderApiDocsPage(env) {
  const botUsername = (env && env.TELEGRAM_BOT_USERNAME) || 'YourAtlasBot';
  const botLink = `https://t.me/${botUsername}`;
  return API_DOCS_HTML_PAGE.replaceAll('__TELEGRAM_BOT_LINK__', botLink);
}

const HTML_PAGE = String.raw`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ATLAS AI — چت با هوش مصنوعی</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg-1: #0b1020;
    --bg-2: #131a33;
    --bg-3: #1c1440;
    --accent: #7c9cff;
    --accent-2: #a78bfa;
    --accent-3: #34d9c9;
    --text: #f3f5ff;
    --text-dim: #aab2d6;
    --text-faint: #6f79a8;
    --err: #ff6b7a;
    --ok: #34d9c9;
    --glass-bg: rgba(255,255,255,0.06);
    --glass-bg-strong: rgba(255,255,255,0.10);
    --glass-border: rgba(255,255,255,0.14);
    --glass-hi: rgba(255,255,255,0.22);
    --glow-1: rgba(124,156,255,0.35);
    --glow-2: rgba(167,139,250,0.30);
    --glow-3: rgba(52,217,201,0.20);
    --mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
    --sans: 'Vazirmatn', system-ui, -apple-system, sans-serif;
    --radius-lg: 22px;
    --radius-md: 16px;
    --radius-sm: 12px;
  }

  /* ---------- Theme: night (تیره‌ی کامل، کنتراست بالا، همون حس شیشه‌ای) ---------- */
  html[data-theme="night"]{
    --bg-1: #05060c;
    --bg-2: #0a0c16;
    --bg-3: #000000;
    --accent: #8b9bff;
    --accent-2: #b48bff;
    --accent-3: #2fd6c4;
    --text: #f5f6ff;
    --text-dim: #9aa1c4;
    --text-faint: #5c6188;
    --glass-bg: rgba(255,255,255,0.045);
    --glass-bg-strong: rgba(255,255,255,0.08);
    --glass-border: rgba(255,255,255,0.10);
    --glass-hi: rgba(255,255,255,0.18);
    --glow-1: rgba(139,155,255,0.20);
    --glow-2: rgba(180,139,255,0.16);
    --glow-3: rgba(47,214,196,0.10);
  }

  /* ---------- Theme: light (روز/روشن، همچنان شیشه‌ای) ---------- */
  html[data-theme="light"]{
    --bg-1: #eef1fb;
    --bg-2: #e4e9fb;
    --bg-3: #f7f5ff;
    --accent: #5b6fe6;
    --accent-2: #8b5cf6;
    --accent-3: #16a596;
    --text: #191b2e;
    --text-dim: #545a7a;
    --text-faint: #8288a8;
    --err: #d6465a;
    --ok: #16a596;
    --glass-bg: rgba(255,255,255,0.55);
    --glass-bg-strong: rgba(255,255,255,0.72);
    --glass-border: rgba(30,32,60,0.10);
    --glass-hi: rgba(30,32,60,0.18);
    --glow-1: rgba(91,111,230,0.22);
    --glow-2: rgba(139,92,246,0.18);
    --glow-3: rgba(22,165,150,0.14);
  }
  html[data-theme="light"] ::selection{ color:#fff; }
  html[data-theme="light"] .code-block, html[data-theme="light"] .msg-body pre{ background:rgba(20,22,40,0.06); }
  html[data-theme="light"] .code-block pre code, html[data-theme="light"] .msg-body code{ color:#191b2e; }
  *{ box-sizing:border-box; }
  html,body{ height:100%; }
  html.lang-en{ direction:ltr; }
  html.lang-en body{ direction:ltr; }
  body{
    margin:0;
    color:var(--text);
    font-family:var(--sans);
    font-size:14.5px;
    overflow:hidden;
    background:
      radial-gradient(1100px 700px at 12% -10%, var(--glow-1), transparent 60%),
      radial-gradient(900px 600px at 110% 10%, var(--glow-2), transparent 55%),
      radial-gradient(1000px 800px at 50% 120%, var(--glow-3), transparent 55%),
      linear-gradient(160deg, var(--bg-1), var(--bg-3) 55%, var(--bg-2));
    background-attachment:fixed;
  }
  ::selection{ background:var(--accent); color:#0b1020; }

  /* subtle floating orbs for depth */
  body::before, body::after{
    content:'';
    position:fixed;
    border-radius:50%;
    filter:blur(80px);
    z-index:0;
    pointer-events:none;
  }
  body::before{
    width:420px; height:420px;
    background:var(--glow-1);
    top:-120px; right:-100px;
  }
  body::after{
    width:380px; height:380px;
    background:var(--glow-3);
    bottom:-140px; left:-80px;
  }

  /* generic glass surface */
  .glass{
    background:var(--glass-bg);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
    backdrop-filter: blur(22px) saturate(160%);
    border:1px solid var(--glass-border);
    box-shadow: 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08);
  }

  /* ---------- Layout ---------- */
  #app{ position:relative; z-index:5; display:flex; height:100vh; width:100vw; padding:14px; gap:14px; }

  /* ---------- Sidebar ---------- */
  #sidebar{
    width:290px;
    min-width:290px;
    display:flex;
    flex-direction:column;
    height:100%;
    border-radius:var(--radius-lg);
    overflow:hidden;
  }
  .brand{
    padding:22px 20px 16px;
    border-bottom:1px solid var(--glass-border);
  }
  .brand-mark{
    font-family:var(--sans);
    font-size:22px;
    font-weight:800;
    color:var(--text);
    display:flex;
    align-items:baseline;
    gap:6px;
    letter-spacing:.01em;
  }
  .brand-mark span{
    background:linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip:text;
    background-clip:text;
    color:transparent;
  }
  .brand-sub{
    margin-top:5px;
    font-size:11.5px;
    color:var(--text-dim);
    letter-spacing:.02em;
  }

  #new-chat-btn{
    margin:16px 16px 8px;
    padding:11px 14px;
    background:linear-gradient(135deg, rgba(124,156,255,0.35), rgba(167,139,250,0.28));
    border:1px solid var(--glass-hi);
    border-radius:var(--radius-sm);
    color:var(--text);
    font-family:var(--sans);
    font-weight:600;
    font-size:13px;
    cursor:pointer;
    text-align:center;
    transition:transform .15s ease, box-shadow .15s ease, background .15s ease;
  }
  #new-chat-btn:hover{ transform:translateY(-1px); box-shadow:0 6px 18px rgba(124,156,255,0.25); }
  #new-chat-btn:active{ transform:translateY(0); }

  #chat-list{
    flex:1;
    overflow-y:auto;
    padding:6px 10px 12px;
  }
  .chat-item{
    padding:11px 12px;
    margin:3px 0;
    font-size:12.8px;
    color:var(--text-dim);
    cursor:pointer;
    border-radius:var(--radius-sm);
    border:1px solid transparent;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
    transition:background .15s ease, color .15s ease, border-color .15s ease;
  }
  .chat-item:hover{ background:var(--glass-bg-strong); color:var(--text); }
  .chat-item.active{
    background:linear-gradient(135deg, rgba(124,156,255,0.22), rgba(167,139,250,0.15));
    color:var(--text);
    border-color:var(--glass-hi);
  }

  #sidebar-footer{
    border-top:1px solid var(--glass-border);
    padding:16px 18px;
  }
  #user-box{ display:flex; align-items:center; gap:10px; }
  #user-avatar{
    width:34px; height:34px; border-radius:50%;
    background:linear-gradient(135deg, var(--accent), var(--accent-2));
    flex-shrink:0;
    object-fit:cover;
    border:1px solid var(--glass-hi);
  }
  #user-name{ font-size:12.5px; font-weight:600; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #user-email{ font-size:10.8px; color:var(--text-faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  #signout-btn{
    margin-top:12px;
    width:100%;
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    color:var(--text-dim);
    font-family:var(--sans); font-size:11.5px; padding:8px; cursor:pointer;
    transition:color .15s ease, border-color .15s ease, background .15s ease;
  }
  #signout-btn:hover{ color:var(--err); border-color:rgba(255,107,122,0.5); background:rgba(255,107,122,0.08); }

  /* ---------- Main ---------- */
  #main{ flex:1; display:flex; flex-direction:column; height:100%; min-width:0; border-radius:var(--radius-lg); overflow:hidden; }

  #topbar{
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:16px 22px;
    border-bottom:1px solid var(--glass-border);
    gap:16px;
  }
  #get-api-key-link{
    display:flex; align-items:center; justify-content:center;
    margin-top:18px;
    padding:12px 16px;
    border-radius:var(--radius-sm);
    background:linear-gradient(135deg, var(--accent), var(--accent-3));
    color:#0b1020;
    font-family:var(--sans); font-weight:700; font-size:13px;
    text-decoration:none;
    transition:opacity .15s ease, transform .15s ease;
  }
  #get-api-key-link:hover{ opacity:.9; transform:translateY(-1px); }
  #model-dropdown-wrap{ position:relative; }
  #model-dropdown-btn{
    display:flex; align-items:center; gap:8px;
    padding:9px 16px;
    font-size:12.5px;
    font-family:var(--sans);
    font-weight:600;
    background:rgba(255,255,255,0.04);
    color:var(--text);
    border:1px solid var(--glass-border);
    border-radius:999px;
    cursor:pointer;
    letter-spacing:.01em;
    transition:border-color .15s ease, background .15s ease;
  }
  #model-dropdown-btn:hover{ border-color:var(--glass-hi); background:var(--glass-bg-strong); }
  .model-caret{ font-size:10px; color:var(--text-dim); transition:transform .15s ease; }
  #model-dropdown-wrap.open .model-caret{ transform:rotate(180deg); }
  #model-dropdown-menu{
    position:absolute; top:calc(100% + 8px); right:0; z-index:40;
    display:flex; flex-direction:column; gap:2px;
    min-width:160px;
    background:var(--glass-bg-strong);
    -webkit-backdrop-filter: blur(24px) saturate(160%);
    backdrop-filter: blur(24px) saturate(160%);
    border:1px solid var(--glass-hi);
    border-radius:var(--radius-sm);
    padding:6px;
    box-shadow:0 12px 36px rgba(0,0,0,0.4);
  }
  #model-dropdown-menu.hidden{ display:none; }
  .model-option{
    padding:9px 14px;
    font-size:12.5px;
    font-family:var(--sans);
    font-weight:600;
    background:transparent;
    color:var(--text-dim);
    border:none;
    border-radius:8px;
    cursor:pointer;
    text-align:right;
    transition:background .15s ease, color .15s ease;
  }
  html.lang-en .model-option{ text-align:left; }
  .model-option:hover{ background:var(--glass-bg); color:var(--text); }
  .model-option.active{
    color:#0b1020;
    background:linear-gradient(135deg, var(--accent), var(--accent-3));
  }

  #settings-btn{
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:999px;
    color:var(--text-dim);
    font-family:var(--sans); font-size:12.5px; font-weight:600; padding:8px 16px; cursor:pointer;
    transition:color .15s ease, border-color .15s ease;
  }
  #settings-btn:hover{ color:var(--accent); border-color:var(--glass-hi); }

  #topbar-actions{ display:flex; align-items:center; gap:8px; }
  #lang-toggle-btn{
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:999px;
    color:var(--text-dim);
    font-family:var(--mono); font-size:11.5px; font-weight:700; padding:8px 13px; cursor:pointer;
    letter-spacing:.03em;
    transition:color .15s ease, border-color .15s ease;
  }
  #lang-toggle-btn:hover{ color:var(--accent-3); border-color:var(--glass-hi); }

  /* ---------- Messages ---------- */
  #messages{
    flex:1;
    overflow-y:auto;
    padding:26px 0 10px;
  }
  .msg-wrap{
    max-width:740px;
    margin:0 auto 20px;
    padding:0 24px;
  }
  .msg-role{
    font-size:10.8px;
    font-weight:700;
    letter-spacing:.06em;
    color:var(--accent-2);
    margin-bottom:7px;
  }
  .msg-role.user{ color:var(--text-faint); }
  .msg-body{
    font-family:var(--sans);
    font-size:15px;
    line-height:1.8;
    color:var(--text);
    white-space:pre-wrap;
    background:var(--glass-bg);
    border:1px solid var(--glass-border);
    border-radius:var(--radius-md);
    padding:14px 18px;
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }
  .msg-body code{
    font-family:var(--mono);
    background:rgba(0,0,0,0.3);
    padding:1px 6px;
    border-radius:6px;
    font-size:13px;
  }
  .msg-body strong{ color:var(--text); font-weight:700; }
  .msg-body em{ font-style:italic; color:var(--text-dim); }
  .msg-body pre{
    background:rgba(0,0,0,0.35);
    border:1px solid var(--glass-border);
    border-radius:var(--radius-sm);
    padding:12px 14px;
    overflow-x:auto;
    font-family:var(--mono);
    font-size:13px;
    line-height:1.6;
  }
  .msg-body pre code{ background:none; padding:0; }

  .msg-body .md-p{ margin:0 0 10px; }
  .msg-body .md-p:last-child{ margin-bottom:0; }
  .msg-body .md-heading{ margin:16px 0 8px; font-weight:800; color:var(--text); line-height:1.5; }
  .msg-body .md-heading:first-child{ margin-top:0; }
  .msg-body .md-h1{ font-size:19px; }
  .msg-body .md-h2{ font-size:17.5px; }
  .msg-body .md-h3{ font-size:16px; }
  .msg-body .md-h4, .msg-body .md-h5, .msg-body .md-h6{ font-size:15px; color:var(--text-dim); }
  .msg-body .md-hr{ border:none; border-top:1px solid var(--glass-border); margin:14px 0; }
  .msg-body .md-list{ margin:0 0 10px; padding-inline-start:22px; line-height:1.8; }
  .msg-body .md-list li{ margin:3px 0; }
  .msg-body a{ color:var(--accent); text-decoration:underline; word-break:break-all; }
  .md-table-wrap{ overflow-x:auto; margin:0 0 10px; max-width:100%; }
  .md-table{ border-collapse:collapse; font-size:0.92em; white-space:normal; }
  .md-table th,.md-table td{ border:1px solid var(--glass-border); padding:6px 10px; vertical-align:top; }
  .md-table th{ background:rgba(127,127,127,0.15); font-weight:700; }
  .pending-attach.ok{ border-color:var(--ok, #3fb950); }
  .pending-attach.fail{ border-color:var(--err); }
  .pending-attach .st{ font-size:11px; opacity:.85; }
  .edit-block{ border:1px solid var(--glass-border); border-radius:12px; margin:0 0 10px; overflow:hidden; direction:ltr; text-align:left; }
  .edit-head{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; background:rgba(127,127,127,0.12); font-size:12px; }
  .edit-diff{ margin:0; padding:8px 10px; font-size:12.5px; line-height:1.6; white-space:pre-wrap; overflow-x:auto; font-family:ui-monospace,Menlo,Consolas,monospace; }
  .edit-diff .del{ background:rgba(248,81,73,0.18); display:block; }
  .edit-diff .add{ background:rgba(63,185,80,0.20); display:block; }
  .msg-actions{ display:flex; gap:6px; margin-top:4px; padding:0 4px; opacity:.65; }
  .msg-wrap-user .msg-actions{ justify-content:flex-start; }
  .msg-actions:hover{ opacity:1; }
  .msg-act-btn{ background:transparent; border:1px solid var(--glass-border); color:inherit; border-radius:8px; font-size:13px; padding:2px 8px; cursor:pointer; }
  .msg-act-btn:hover{ border-color:var(--glass-hi); color:var(--accent); }
  .ref-note{ font-size:12px; opacity:.8; margin-bottom:6px; }
  .edit-status{ font-size:12px; padding:0 10px 6px; }

  .msg-wrap-user .msg-body{
    background:linear-gradient(135deg, rgba(124,156,255,0.16), rgba(167,139,250,0.10));
    border-color:var(--glass-hi);
    margin-inline-start:14%;
  }

  .attach-preview-row{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .attach-preview-img{ width:96px; height:96px; object-fit:cover; border-radius:10px; border:1px solid var(--glass-border); }
  .attach-preview-file{
    display:inline-flex; align-items:center; gap:6px;
    padding:8px 12px; border-radius:10px;
    background:rgba(0,0,0,0.25); border:1px solid var(--glass-border);
    color:var(--text-dim); font-size:12.5px; text-decoration:none;
  }
  .attach-preview-file:hover{ color:var(--accent); border-color:var(--glass-hi); }

  #empty-state{
    max-width:600px; margin:14vh auto; text-align:center; padding:0 24px;
  }
  #empty-state h1{
    font-family:var(--sans); font-weight:800; font-size:29px; margin:0 0 10px;
    background:linear-gradient(90deg, var(--text), var(--accent-2));
    -webkit-background-clip:text; background-clip:text; color:transparent;
  }
  #empty-state p{ color:var(--text-dim); font-size:13.5px; line-height:1.8; }

  .typing{ display:inline-flex; gap:5px; align-items:center; padding:6px 2px; }
  .typing span{ width:6px; height:6px; background:var(--accent-2); border-radius:50%; animation:blink 1.2s infinite ease-in-out; }
  .typing span:nth-child(2){ animation-delay:.2s; }
  .typing span:nth-child(3){ animation-delay:.4s; }
  @keyframes blink{ 0%,80%,100%{opacity:.25;} 40%{opacity:1;} }

  /* ---------- Composer ---------- */
  #composer{
    border-top:1px solid var(--glass-border);
    padding:16px 24px 22px;
  }
  #composer-attach-preview{
    max-width:740px; margin:0 auto 8px;
    display:flex; flex-wrap:wrap; gap:8px;
  }
  #composer-attach-preview:empty{ display:none; }
  .pending-attach{
    position:relative;
    display:flex; align-items:center; gap:6px;
    background:var(--glass-bg); border:1px solid var(--glass-border);
    border-radius:10px; padding:6px 10px; font-size:11.5px; color:var(--text-dim);
  }
  .pending-attach img{ width:32px; height:32px; object-fit:cover; border-radius:6px; }
  .pending-attach-remove{
    background:none; border:none; color:var(--text-faint); cursor:pointer; font-size:13px; padding:0 2px;
  }
  .pending-attach-remove:hover{ color:var(--err); }
  #attach-btn{
    flex-shrink:0;
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    color:var(--text-dim); font-size:16px; padding:9px 11px; cursor:pointer;
    transition:color .15s ease, border-color .15s ease;
  }
  #attach-btn:hover{ color:var(--accent); border-color:var(--glass-hi); }
  #mic-btn{
    flex-shrink:0;
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    color:var(--text-dim); font-size:16px; padding:9px 11px; cursor:pointer;
    transition:color .15s ease, border-color .15s ease, background .15s ease;
  }
  #mic-btn:hover{ border-color:var(--glass-hi); }
  #mic-btn.recording{ background:var(--err); color:#fff; border-color:transparent; animation:micpulse 1s infinite; }
  #mic-btn.busy{ opacity:.5; cursor:wait; }
  @keyframes micpulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(255,107,122,.6);} 50%{ box-shadow:0 0 0 8px rgba(255,107,122,0);} }
  #think-atlas-toggle-btn{
    flex-shrink:0;
    display:flex; align-items:center; gap:6px;
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    color:var(--text-faint); font-size:12px; font-family:var(--sans); font-weight:600;
    padding:9px 12px; cursor:pointer;
    transition:color .15s ease, border-color .15s ease, background .15s ease;
  }
  #think-atlas-toggle-btn:hover{ border-color:var(--glass-hi); }
  #think-atlas-toggle-btn .ws-icon{ font-size:14px; filter:grayscale(1); opacity:.6; transition:filter .15s ease, opacity .15s ease; }
  #think-atlas-toggle-btn.active{
    color:#0b1020;
    background:linear-gradient(135deg, var(--accent), var(--accent-3));
    border-color:transparent;
  }
  #think-atlas-toggle-btn.active .ws-icon{ filter:none; opacity:1; }
  @media (max-width: 640px){
    #think-atlas-toggle-btn .ws-label{ display:none; }
    #think-atlas-toggle-btn{ padding:9px 10px; }
  }
  #composer-inner{
    max-width:740px; margin:0 auto;
    display:flex; align-items:flex-end; gap:10px;
    background:var(--glass-bg-strong);
    border:1px solid var(--glass-border);
    border-radius:var(--radius-md);
    padding:11px 14px;
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
    transition:border-color .15s ease, box-shadow .15s ease;
  }
  #composer-inner:focus-within{ border-color:var(--glass-hi); box-shadow:0 0 0 3px rgba(124,156,255,0.15); }
  #msg-input{
    flex:1;
    background:none; border:none; outline:none; resize:none;
    color:var(--text);
    font-family:var(--sans);
    font-size:14.5px;
    line-height:1.6;
    max-height:200px;
    padding:5px 2px;
  }
  #msg-input::placeholder{ color:var(--text-faint); }
  #send-btn{
    background:linear-gradient(135deg, var(--accent), var(--accent-3));
    color:#0b1020; border:none; border-radius:var(--radius-sm);
    font-family:var(--sans); font-size:12.5px; font-weight:700;
    padding:10px 18px; cursor:pointer; flex-shrink:0;
    letter-spacing:.01em;
    transition:transform .15s ease, box-shadow .15s ease;
  }
  #send-btn:disabled{ opacity:.4; cursor:not-allowed; }
  #send-btn:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 6px 16px rgba(124,156,255,0.35); }

  /* ---------- Overlays ---------- */
  .overlay{
    position:fixed; inset:0; background:rgba(6,8,20,.55);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    display:flex; align-items:center; justify-content:center;
    z-index:100;
  }
  .overlay.hidden{ display:none; }
  .modal{
    background:var(--glass-bg-strong);
    -webkit-backdrop-filter: blur(28px) saturate(160%);
    backdrop-filter: blur(28px) saturate(160%);
    border:1px solid var(--glass-hi);
    border-radius:var(--radius-lg);
    width:min(480px, 92vw);
    max-height:86vh;
    overflow-y:auto;
    padding:28px;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
  }
  .modal h2{
    font-family:var(--sans); font-weight:800; font-size:20px; margin:0 0 6px; color:var(--text);
  }
  .modal .hint{ color:var(--text-dim); font-size:12px; margin:0 0 18px; line-height:1.7; }
  .field-group{
    border:1px solid var(--glass-border); border-radius:var(--radius-sm); padding:14px; margin-bottom:12px;
    background:rgba(255,255,255,0.03);
  }
  .field-group h3{
    font-size:12px; color:var(--accent-2); margin:0 0 10px; letter-spacing:.02em; font-weight:700;
  }
  .field-row{ margin-bottom:9px; }
  .field-row label{
    display:block; font-size:10.8px; color:var(--text-dim); margin-bottom:4px;
  }
  .field-row input{
    width:100%;
    background:rgba(0,0,0,0.25);
    border:1px solid var(--glass-border);
    border-radius:8px;
    color:var(--text);
    font-family:var(--mono);
    font-size:12.5px;
    padding:9px 11px;
    outline:none;
  }
  .field-row input:focus{ border-color:var(--accent); }

  #settings-close{
    position:absolute; top:22px; left:22px;
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:50%;
    width:30px; height:30px;
    color:var(--text-dim); font-size:16px; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    transition:color .15s ease, border-color .15s ease;
  }
  #settings-close:hover{ color:var(--err); border-color:rgba(255,107,122,0.5); }
  .modal{ position:relative; }

  /* Login overlay */
  #login-overlay .modal{ text-align:center; padding:44px 34px; }
  #login-overlay .brand-mark{ justify-content:center; font-size:28px; margin-bottom:8px; }
  #login-overlay .hint{ margin-bottom:26px; }
  #google-btn-container{ display:flex; justify-content:center; }

  /* Scrollbars */
  ::-webkit-scrollbar{ width:8px; }
  ::-webkit-scrollbar-thumb{ background:rgba(255,255,255,0.15); border-radius:8px; }
  ::-webkit-scrollbar-thumb:hover{ background:rgba(255,255,255,0.25); }
  ::-webkit-scrollbar-track{ background:transparent; }

  #menu-btn{
    display:none; background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm); color:var(--text);
    padding:7px 12px; font-family:var(--sans); cursor:pointer; flex-shrink:0;
  }
  #theme-btn{
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm); color:var(--text);
    padding:7px 11px; font-family:var(--sans); font-size:15px; cursor:pointer; flex-shrink:0;
    transition:border-color .15s ease, background .15s ease;
  }
  #theme-btn:hover{ border-color:var(--glass-hi); background:var(--glass-bg-strong); }
  #theme-options{ display:flex; flex-direction:column; gap:8px; }
  .theme-option{
    display:flex; align-items:center; gap:12px;
    padding:12px 14px;
    background:rgba(255,255,255,0.03);
    border:1px solid var(--glass-border);
    border-radius:var(--radius-sm);
    color:var(--text);
    font-family:var(--sans); font-size:13px; font-weight:600;
    cursor:pointer; text-align:right;
    transition:border-color .15s ease, background .15s ease;
  }
  html.lang-en .theme-option{ text-align:left; }
  .theme-option:hover{ border-color:var(--glass-hi); }
  .theme-option.active{ border-color:var(--accent); background:rgba(124,156,255,0.10); }
  .theme-swatch{
    width:30px; height:30px; border-radius:50%; flex-shrink:0;
    border:1px solid var(--glass-border);
  }
  .theme-swatch-modern{ background:linear-gradient(135deg, #7c9cff, #a78bfa 60%, #1c1440); }
  .theme-swatch-night{ background:linear-gradient(135deg, #8b9bff, #05060c 70%); }
  .theme-swatch-light{ background:linear-gradient(135deg, #eef1fb, #8b5cf6 120%); }
  #sidebar-backdrop{
    display:none;
    position:fixed; inset:0; z-index:55;
    background:rgba(6,8,20,.5);
  }
  #sidebar-backdrop.show{ display:block; }

  /* Mobile */
  @media (max-width: 760px){
    html, body{ font-size:16px; }
    #app{ padding:0; gap:0; height:100dvh; width:100vw; }
    #main{ border-radius:0; height:100dvh; }
    #sidebar{
      position:fixed; z-index:60; height:100dvh; top:0; right:0;
      transform:translateX(110%); transition:transform .25s ease;
      width:82vw; min-width:82vw; border-radius:0;
    }
    #sidebar.open{ transform:translateX(0); }
    #menu-btn{ display:inline-flex !important; align-items:center; justify-content:center; font-size:18px; z-index:2; }
    #theme-btn{ padding:7px 9px; font-size:14px; }
    #topbar{ padding:12px 14px; gap:10px; }
    #topbar-actions{ gap:6px; }
    #settings-btn{ padding:8px 12px; font-size:11.5px; }
    #lang-toggle-btn{ padding:8px 10px; }
    .msg-wrap{ padding:0 14px; max-width:100%; }
    .msg-body{ font-size:15.5px; }
    #composer{ padding:10px 12px 14px; }
    #composer-inner{ padding:9px 10px; }
    #model-dropdown-btn{ padding:8px 12px; font-size:12px; }
    #model-dropdown-menu{ right:auto; left:0; min-width:150px; }
    html.lang-en #model-dropdown-menu{ left:auto; right:0; }
    .modal{ width:94vw; padding:22px; }
    #attach-menu{ right:auto; left:0; }
    html.lang-en #attach-menu{ left:auto; right:0; }
  }
  @media (max-width: 420px){
    #sidebar{ width:88vw; min-width:88vw; }
  }

  /* ---------- Chat item with delete ---------- */
  .chat-item-row{
    display:flex; align-items:center; gap:6px;
    margin:3px 0;
  }
  .chat-item-row .chat-item{ flex:1; margin:0; }
  .chat-delete-btn{
    flex-shrink:0;
    width:26px; height:26px;
    border-radius:8px;
    border:1px solid var(--glass-border);
    background:transparent;
    color:var(--text-faint);
    font-size:13px;
    cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    transition:color .15s ease, border-color .15s ease, background .15s ease;
    opacity:0;
  }
  .chat-item-row:hover .chat-delete-btn{ opacity:1; }
  .chat-delete-btn:hover{ color:var(--err); border-color:rgba(255,107,122,0.5); background:rgba(255,107,122,0.08); }

  /* ---------- Code blocks ---------- */
  .code-block{
    position:relative;
    margin:10px 0;
    border-radius:var(--radius-sm);
    overflow:hidden;
    border:1px solid var(--glass-border);
    background:rgba(0,0,0,0.38);
  }
  .code-block-header{
    display:flex; align-items:center; justify-content:space-between;
    padding:7px 12px;
    background:rgba(255,255,255,0.04);
    border-bottom:1px solid var(--glass-border);
    font-family:var(--mono);
    font-size:11px;
    color:var(--text-faint);
  }
  .code-copy-btn{
    background:var(--glass-bg);
    border:1px solid var(--glass-border);
    border-radius:7px;
    color:var(--text-dim);
    font-family:var(--sans);
    font-size:11px;
    padding:4px 10px;
    cursor:pointer;
    transition:color .15s ease, border-color .15s ease, background .15s ease;
  }
  .code-copy-btn:hover{ color:var(--accent); border-color:var(--glass-hi); }
  .code-copy-btn.copied{ color:var(--ok); border-color:rgba(52,217,201,0.5); }
  .code-block pre{
    margin:0;
    background:transparent;
    border:none;
    border-radius:0;
    padding:12px 14px;
    overflow-x:auto;
    font-family:var(--mono);
    font-size:13px;
    line-height:1.65;
    direction:ltr;
    text-align:left;
  }
  .code-block pre code{ background:none; padding:0; }
</style>
</head>
<body>

<div id="app">
  <div id="sidebar-backdrop"></div>

  <div id="sidebar" class="glass">
    <div class="brand">
      <div class="brand-mark">ATLAS<span> AI</span></div>
      <div class="brand-sub" data-i18n="brandSub">چت با چهار مدل زبانی</div>
    </div>
    <button id="new-chat-btn" data-i18n="newChat">+ گفتگوی تازه</button>
    <div id="chat-list"></div>
    <div id="sidebar-footer">
      <div id="user-box">
        <img id="user-avatar" src="" alt="">
        <div style="overflow:hidden">
          <div id="user-name"></div>
          <div id="user-email"></div>
        </div>
      </div>
      <button id="signout-btn" data-i18n="signOut">خروج از حساب</button>
    </div>
  </div>

  <div id="main" class="glass">
    <div id="topbar">
      <button id="menu-btn">☰</button>
      <button id="theme-btn" title="تم">🎨</button>
      <div id="model-dropdown-wrap">
        <button id="model-dropdown-btn" type="button">
          <span id="model-dropdown-label">Ai-2</span>
          <span class="model-caret">▾</span>
        </button>
        <div id="model-dropdown-menu" class="hidden">
          <button class="model-option active" data-model="ai2">Ai-2</button>
          <button class="model-option" data-model="ai3">Ai-3</button>
          <button class="model-option" data-model="star1">Star-1</button>
          <button class="model-option" data-model="star2">Star-2</button>
        </div>
      </div>
      <div id="topbar-actions">
        <button id="lang-toggle-btn" title="زبان / Language">FA</button>
        <button id="settings-btn" data-i18n="apiSettings">تنظیمات API</button>
      </div>
    </div>

    <div id="messages">
      <div id="empty-state">
        <h1 data-i18n="emptyTitle">با یکی از چهار مدل شروع کن</h1>
        <p data-i18n="emptyDesc">مدل مورد نظرت رو از بالا انتخاب کن و چت رو شروع کن. کلیدها و تنظیمات مدل‌ها روی سرور هستن.</p>
      </div>
    </div>

    <div id="composer">
      <div id="composer-attach-preview"></div>
      <div id="composer-inner">
        <div id="attach-wrap">
          <button id="attach-btn" type="button" title="پیوست">📎</button>
          <input type="file" id="file-input" multiple accept="image/*,.py,.txt,.js,.json,.md,.csv,.html,.css,.ts,.jsx,.tsx" style="display:none">
        </div>
        <button id="mic-btn" type="button" title="Voice">🎤</button>
        <button id="think-atlas-toggle-btn" type="button" title="ThinkAtlas" style="display:none">
          <span class="ws-icon">🧠</span>
          <span class="ws-label" data-i18n="thinkAtlasButton">ThinkAtlas</span>
        </button>
        <textarea id="msg-input" rows="1" data-i18n-placeholder="composerPlaceholder" placeholder="پیامت رو بنویس…"></textarea>
        <button id="send-btn" data-i18n="send">ارسال</button>
      </div>
    </div>
  </div>

</div>

<!-- Settings modal — فقط وضعیت مدل‌ها نمایش داده می‌شه؛ کلیدها روی سرور هستن -->
<div class="overlay hidden" id="settings-overlay">
  <div class="modal">
    <button id="settings-close">✕</button>
    <h2 data-i18n="modelStatusTitle">وضعیت مدل‌ها</h2>
    <div id="model-status-list">
      <div class="field-group" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
        <span style="font-size:13px;color:var(--text)">Ai-2</span>
        <span id="status-ai2" style="font-size:11px" data-i18n="checking">بررسی...</span>
      </div>
      <div class="field-group" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
        <span style="font-size:13px;color:var(--text)">Ai-3</span>
        <span id="status-ai3" style="font-size:11px" data-i18n="checking">بررسی...</span>
      </div>
      <div class="field-group" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
        <span style="font-size:13px;color:var(--text)">Star-1</span>
        <span id="status-star1" style="font-size:11px" data-i18n="checking">بررسی...</span>
      </div>
      <div class="field-group" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px">
        <span style="font-size:13px;color:var(--text)">Star-2</span>
        <span id="status-star2" style="font-size:11px" data-i18n="checking">بررسی...</span>
      </div>
    </div>
    <a id="get-api-key-link" href="/api" target="_blank" rel="noopener">
      <span data-i18n="getApiKeyBtn">🔑 دریافت کلید API</span>
    </a>
  </div>
</div>

<!-- Theme modal -->
<div class="overlay hidden" id="theme-overlay">
  <div class="modal">
    <button id="theme-close">✕</button>
    <h2 data-i18n="themeTitle">تم برنامه</h2>
    <p class="hint" data-i18n="themeHint">یکی از تم‌های زیر رو انتخاب کن. همه‌ی تم‌ها حالت شیشه‌ای (glass) و مدرن دارن.</p>
    <div id="theme-options">
      <button class="theme-option" data-theme="modern">
        <span class="theme-swatch theme-swatch-modern"></span>
        <span data-i18n="themeModern">مدرن (بنفش/آبی)</span>
      </button>
      <button class="theme-option" data-theme="night">
        <span class="theme-swatch theme-swatch-night"></span>
        <span data-i18n="themeNight">شب (تیره کامل)</span>
      </button>
      <button class="theme-option" data-theme="light">
        <span class="theme-swatch theme-swatch-light"></span>
        <span data-i18n="themeLight">روز (روشن)</span>
      </button>
    </div>
  </div>
</div>

<!-- Login overlay -->
<div class="overlay" id="login-overlay">
  <div class="modal">
    <div class="brand-mark">ATLAS<span> AI</span></div>
    <p class="hint" data-i18n="loginHint">برای شروع چت، با حساب گوگل وارد شو.</p>
    <div id="google-btn-container"></div>
  </div>
</div>

<script>
(function(){
  "use strict";

  var state = {
    user: null,
    activeModel: 'ai2',
    activeChatId: null,
    chats: {}, // id -> {id, title, messages:[{role,content}]}
    serverModels: { ai2:{configured:false}, ai3:{configured:false}, star1:{configured:false}, star2:{configured:false} },
    busy: false,
    lang: 'fa',
    theme: 'modern',
    thinkAtlasEnabled: false,
  };

  var MODEL_LABELS = { ai2: 'Ai-2', ai3: 'Ai-3', star1: 'Star-1', star2: 'Star-2' };

  // ---------- زبان / Language ----------
  var I18N = {
    fa: {
      brandSub: 'چت با چهار مدل زبانی',
      newChat: '+ گفتگوی تازه',
      signOut: 'خروج از حساب',
      apiSettings: 'تنظیمات API',
      emptyTitle: 'با یکی از چهار مدل شروع کن',
      emptyDesc: 'مدل مورد نظرت رو از بالا انتخاب کن و چت رو شروع کن. کلیدها و تنظیمات مدل‌ها روی سرور هستن.',
      composerPlaceholder: 'پیامت رو بنویس…',
      send: 'ارسال',
      modelStatusTitle: 'وضعیت مدل‌ها',
      checking: 'بررسی...',
      getApiKeyBtn: '🔑 دریافت کلید API',
      loginHint: 'برای شروع چت، با حساب گوگل وارد شو.',
      modelConfigured: '✓ پیکربندی شده',
      modelNotConfigured: '✗ تنظیم نشده',
      you: 'شما',
      untitledChat: 'گفتگوی بدون عنوان',
      deleteChatTitle: 'حذف گفتگو',
      confirmDeleteChat: 'این گفتگو برای همیشه حذف بشه؟',
      copyBtn: 'کپی',
      copiedBtn: 'کپی شد ✓',
      codeLabel: 'کد',
      downloadBtn: 'دانلود',
      refNote: 'مربوط به فایل', editMsgTitle: 'ویرایش و ارسال دوباره',
      attachPreparing: 'در حال آماده‌سازی…', attachUploading: 'در حال آپلود…', attachFailed: 'آپلود نشد', attachUploaded: 'آپلود شد',
      attachWait: 'لطفاً صبر کنید تا فایل/عکس آماده و آپلود شود', editApplyBtn: 'اعمال و دانلود', editApplied: 'تغییرات اعمال شد', editNotFound: 'کد اصلی برای این تغییرات پیدا نشد', editLabel: 'ویرایش',
      micUnsupported: 'مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.',
      micDenied: 'دسترسی به میکروفون داده نشد.',
      errorReply: 'خطا در دریافت پاسخ: ',
      modelNotConfiguredAlert: 'روی سرور تنظیم نشده. در Cloudflare Dashboard، Variables مربوطه رو اضافه کن.',
      chatMessageLimitReached: '⛔ این چت به سقف ۱۳ پیام رسیده. لطفاً یک گفتگوی تازه باز کن تا ادامه بدی.',
      thinkAtlasButton: '🧠 ThinkAtlas',
      thinkingLabel: '🧠 ThinkAtlas',
      googleClientMissing: 'Google Client ID روی سرور تنظیم نشده. متغیر GOOGLE_CLIENT_ID رو در Cloudflare تنظیم کن.',
      emptyReply: '(پاسخ خالی)',
      genericError: 'خطا: ',
      invalidResponse: 'پاسخ نامعتبر از سرور مدل.',
      fileTooLarge: 'حجم فایل بیش از حد مجاز است (حداکثر ۲۰ مگابایت).',
      themeTitle: 'تم برنامه',
      themeHint: 'یکی از تم‌های زیر رو انتخاب کن. همه‌ی تم‌ها حالت شیشه‌ای و مدرن دارن.',
      themeModern: 'مدرن (بنفش/آبی)',
      themeNight: 'شب (تیره کامل)',
      themeLight: 'روز (روشن)',
    },
    en: {
      brandSub: 'Chat with four language models',
      newChat: '+ New chat',
      signOut: 'Sign out',
      apiSettings: 'API Settings',
      emptyTitle: 'Start with one of the four models',
      emptyDesc: 'Pick a model from above and start chatting. Keys and model settings live on the server.',
      composerPlaceholder: 'Write your message…',
      send: 'Send',
      modelStatusTitle: 'Model status',
      checking: 'Checking...',
      getApiKeyBtn: '🔑 Get API Key',
      loginHint: 'Sign in with Google to start chatting.',
      modelConfigured: '✓ Configured',
      modelNotConfigured: '✗ Not configured',
      you: 'You',
      untitledChat: 'Untitled chat',
      deleteChatTitle: 'Delete chat',
      confirmDeleteChat: 'Delete this chat permanently?',
      copyBtn: 'Copy',
      copiedBtn: 'Copied ✓',
      codeLabel: 'code',
      downloadBtn: 'Download',
      refNote: 'About file', editMsgTitle: 'Edit and resend',
      attachPreparing: 'Preparing…', attachUploading: 'Uploading…', attachFailed: 'Upload failed', attachUploaded: 'Uploaded',
      attachWait: 'Please wait until the file/image is ready and uploaded', editApplyBtn: 'Apply & download', editApplied: 'Edits applied', editNotFound: 'Original code not found for these edits', editLabel: 'Edit',
      micUnsupported: 'Your browser does not support audio recording.',
      micDenied: 'Microphone access was denied.',
      errorReply: 'Error getting reply: ',
      modelNotConfiguredAlert: 'is not configured on the server. Add the relevant Variables in the Cloudflare Dashboard.',
      chatMessageLimitReached: '⛔ This chat has reached its 13-message limit. Please start a new conversation to continue.',
      thinkAtlasButton: '🧠 ThinkAtlas',
      thinkingLabel: '🧠 ThinkAtlas',
      googleClientMissing: 'Google Client ID is not set on the server. Set the GOOGLE_CLIENT_ID variable in Cloudflare.',
      emptyReply: '(empty response)',
      genericError: 'Error: ',
      invalidResponse: 'Invalid response from the model server.',
      fileTooLarge: 'File is too large (max 20MB).',
      themeTitle: 'App theme',
      themeHint: 'Pick one of the themes below. All themes keep the glass, modern feel.',
      themeModern: 'Modern (purple/blue)',
      themeNight: 'Night (full dark)',
      themeLight: 'Light (bright)',
    },
  };

  function t(key){
    var dict = I18N[state.lang] || I18N.fa;
    return (dict && dict[key] !== undefined) ? dict[key] : (I18N.fa[key] || key);
  }

  function applyLanguage(){
    document.documentElement.lang = (state.lang === 'en') ? 'en' : 'fa';
    document.documentElement.classList.toggle('lang-en', state.lang === 'en');
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
      var key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = t(key);
    });
    var $langBtn = document.getElementById('lang-toggle-btn');
    if($langBtn) $langBtn.textContent = (state.lang === 'en') ? 'FA' : 'EN';
    // چت‌های فعلی رو دوباره رندر کن تا برچسب نقش‌ها (شما/You) به‌روز بشن
    if(state.activeChatId && state.chats[state.activeChatId]){
      renderMessages(state.chats[state.activeChatId].messages || []);
    } else if(!state.activeChatId){
      renderMessages([]);
    }
  }

  function setLanguage(lang){
    state.lang = (lang === 'en') ? 'en' : 'fa';
    try{ localStorage.setItem('atlas_lang', state.lang); }catch(e){}
    applyLanguage();
  }

  // ---------- Storage helpers (API for chat history) ----------

  // ---------- DOM refs ----------
  var $messages = document.getElementById('messages');
  var $emptyState = document.getElementById('empty-state');
  var $input = document.getElementById('msg-input');
  var $sendBtn = document.getElementById('send-btn');
  var $attachBtn = document.getElementById('attach-btn');
  var $fileInput = document.getElementById('file-input');
  var $attachPreview = document.getElementById('composer-attach-preview');
  var $chatList = document.getElementById('chat-list');
  var $modelDropdownWrap = document.getElementById('model-dropdown-wrap');
  var $modelDropdownBtn = document.getElementById('model-dropdown-btn');
  var $modelDropdownLabel = document.getElementById('model-dropdown-label');
  var $modelDropdownMenu = document.getElementById('model-dropdown-menu');
  var $modelOptions = document.querySelectorAll('.model-option');
  var $settingsOverlay = document.getElementById('settings-overlay');
  var $loginOverlay = document.getElementById('login-overlay');
  var $sidebar = document.getElementById('sidebar');

  document.getElementById('lang-toggle-btn').addEventListener('click', function(){
    setLanguage(state.lang === 'en' ? 'fa' : 'en');
  });

  // ---------- Model dropdown ----------
  function setActiveModel(modelKey){
    state.activeModel = modelKey;
    $modelOptions.forEach(function(opt){
      opt.classList.toggle('active', opt.dataset.model === modelKey);
    });
    if($modelDropdownLabel) $modelDropdownLabel.textContent = MODEL_LABELS[modelKey] || modelKey;
    var btn = document.getElementById('think-atlas-toggle-btn');
    if(btn){
      var isStar2 = modelKey === 'star2';
      btn.style.display = isStar2 ? '' : 'none';
      if(!isStar2) state.thinkAtlasEnabled = false;
      btn.classList.toggle('active', !!state.thinkAtlasEnabled);
      btn.title = isStar2 ? 'ThinkAtlas' : '';
    }
  }
  function closeModelDropdown(){
    $modelDropdownMenu.classList.add('hidden');
    $modelDropdownWrap.classList.remove('open');
  }
  function toggleModelDropdown(){
    var isOpen = !$modelDropdownMenu.classList.contains('hidden');
    if(isOpen){ closeModelDropdown(); }
    else{
      $modelDropdownMenu.classList.remove('hidden');
      $modelDropdownWrap.classList.add('open');
    }
  }
  $modelDropdownBtn.addEventListener('click', function(e){
    e.stopPropagation();
    toggleModelDropdown();
  });
  $modelOptions.forEach(function(opt){
    opt.addEventListener('click', function(){
      setActiveModel(opt.dataset.model);
      closeModelDropdown();
    });
  });
  document.addEventListener('click', function(e){
    if(!$modelDropdownWrap.contains(e.target)) closeModelDropdown();
  });

  // ---------- ThinkAtlas toggle (فقط برای STAR-2) ----------
  var $thinkAtlasBtn = document.getElementById('think-atlas-toggle-btn');
  if($thinkAtlasBtn) $thinkAtlasBtn.style.display = (state.activeModel === 'star2') ? '' : 'none';
  function applyThinkAtlasToggle(enabled){
    state.thinkAtlasEnabled = state.activeModel === 'star2' && !!enabled;
    if($thinkAtlasBtn){
      $thinkAtlasBtn.classList.toggle('active', state.thinkAtlasEnabled);
      $thinkAtlasBtn.title = 'ThinkAtlas';
    }
  }
  if($thinkAtlasBtn){
    $thinkAtlasBtn.addEventListener('click', function(){
      if(state.activeModel !== 'star2') return;
      applyThinkAtlasToggle(!state.thinkAtlasEnabled);
    });
  }

  // ---------- Theme ----------
  var $themeOverlay = document.getElementById('theme-overlay');
  var $themeOptions = document.querySelectorAll('.theme-option');
  function applyTheme(theme){
    state.theme = (theme === 'night' || theme === 'light') ? theme : 'modern';
    if(state.theme === 'modern'){
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', state.theme);
    }
    $themeOptions.forEach(function(opt){
      opt.classList.toggle('active', opt.dataset.theme === state.theme);
    });
    try{ localStorage.setItem('atlas_theme', state.theme); }catch(e){}
  }
  document.getElementById('theme-btn').addEventListener('click', function(){
    $themeOverlay.classList.remove('hidden');
  });
  document.getElementById('theme-close').addEventListener('click', function(){
    $themeOverlay.classList.add('hidden');
  });
  $themeOptions.forEach(function(opt){
    opt.addEventListener('click', function(){
      applyTheme(opt.dataset.theme);
    });
  });

  // ---------- Settings modal (فقط نمایش وضعیت — کلیدها روی سرور) ----------
  document.getElementById('settings-btn').addEventListener('click', function(){
    renderModelStatus();
    $settingsOverlay.classList.remove('hidden');
  });
  document.getElementById('settings-close').addEventListener('click', function(){
    $settingsOverlay.classList.add('hidden');
  });
  function renderModelStatus(){
    ['ai2','ai3','star1'].forEach(function(m){
      var el = document.getElementById('status-'+m);
      if(!el) return;
      var ok = state.serverModels[m] && state.serverModels[m].configured;
      el.textContent = ok ? t('modelConfigured') : t('modelNotConfigured');
      el.style.color = ok ? 'var(--signal)' : 'var(--err)';
    });
  }

  // ---------- Mobile menu ----------
  var $sidebarBackdrop = document.getElementById('sidebar-backdrop');
  function openSidebar(){
    $sidebar.classList.add('open');
    $sidebarBackdrop.classList.add('show');
  }
  function closeSidebar(){
    $sidebar.classList.remove('open');
    $sidebarBackdrop.classList.remove('show');
  }
  document.getElementById('menu-btn').addEventListener('click', function(){
    if($sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
  });
  $sidebarBackdrop.addEventListener('click', closeSidebar);

  // ---------- Attachments (file/image upload) ----------
  var pendingAttachments = []; // [{name, mimeType, isImage, dataUrl, storageId, uploading}]
  var MAX_ATTACH_BYTES = 20 * 1024 * 1024; // 20MB per file, keep well under Telegram/KV limits

  $attachBtn.addEventListener('click', function(){ $fileInput.click(); });
  $fileInput.addEventListener('change', function(){
    var files = Array.prototype.slice.call($fileInput.files || []);
    files.forEach(handleSelectedFile);
    $fileInput.value = '';
  });

  function handleSelectedFile(file){
    if(file.size > MAX_ATTACH_BYTES){
      alert(t('fileTooLarge'));
      return;
    }
    var isImage = file.type && file.type.indexOf('image/') === 0;
    var entry = { name: file.name, mimeType: file.type || 'application/octet-stream', isImage: isImage, file: file, storageId: null, uploading: true };
    pendingAttachments.push(entry);
    renderAttachPreview();

    entry.preparing = true;
    renderAttachPreview();

    if(isImage){
      compressImageFile(file).then(function(res){
        entry.dataUrl = res.dataUrl;
        entry.file = res.blob || file;
        entry.mimeType = res.mime || entry.mimeType;
        if(res.blob && /\.[a-z0-9]+$/i.test(entry.name) && res.mime === 'image/jpeg'){ entry.name = entry.name.replace(/\.[a-z0-9]+$/i, '.jpg'); }
        entry.preparing = false;
        renderAttachPreview();
        uploadAttachment(entry);
      });
    } else {
      var textReader = new FileReader();
      textReader.onload = function(){
        entry.textContent = minifyTextForAI(entry.name, String(textReader.result || ''));
        entry.preparing = false;
        renderAttachPreview();
      };
      textReader.onerror = function(){ entry.preparing = false; renderAttachPreview(); };
      textReader.readAsText(file);
      uploadAttachment(entry);
    }
  }

  // ---------- فشرده‌سازی عکس (کانواس): حداکثر ۱۰۲۴ پیکسل، JPEG با کیفیت ۰.۷ ----------
  var IMG_MAX_SIDE = 1024;
  var IMG_QUALITY = 0.7;
  function compressImageFile(file){
    return new Promise(function(resolve){
      var fr = new FileReader();
      fr.onerror = function(){ resolve({ dataUrl:null }); };
      fr.onload = function(){
        var original = fr.result;
        if(/image\/(gif|svg)/.test(file.type) || file.size < 60000){ resolve({ dataUrl: original }); return; }
        var img = new Image();
        img.onerror = function(){ resolve({ dataUrl: original }); };
        img.onload = function(){
          try{
            var w = img.naturalWidth, h = img.naturalHeight;
            var scale = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            var ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            var out = cv.toDataURL('image/jpeg', IMG_QUALITY);
            if(out.length >= original.length){ resolve({ dataUrl: original }); return; }
            cv.toBlob(function(blob){
              resolve({ dataUrl: out, blob: blob, mime: 'image/jpeg' });
            }, 'image/jpeg', IMG_QUALITY);
          }catch(e){ resolve({ dataUrl: original }); }
        };
        img.src = original;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------- کم‌کردن توکن فایل متنی/کد: حذف فاصله‌ی اضافه، خط خالی و کامنت‌های تک‌خطی ----------
  var TEXT_MAX_CHARS = 24000;
  function minifyTextForAI(name, text){
    var ext = (String(name).split('.').pop() || '').toLowerCase();
    var out = text.replace(/\r\n?/g, '\n');
    if(ext === 'json'){
      try{ return capText(JSON.stringify(JSON.parse(out))); }catch(e){}
    }
    var hashLang = ['py','sh','rb','yml','yaml'].indexOf(ext) >= 0;
    var slashLang = ['js','ts','jsx','tsx','java','c','cpp','cs','go','rs','php','swift','kt'].indexOf(ext) >= 0;
    var keepIndent = ['py','yml','yaml','md','txt','csv'].indexOf(ext) >= 0;
    var lines = out.split('\n'), res = [], blank = 0;
    for(var i = 0; i < lines.length; i++){
      var ln = lines[i].replace(/\s+$/, '');
      var tr = ln.trim();
      if(hashLang && tr.charAt(0) === '#' && tr.charAt(1) !== '!') continue;
      if(slashLang && tr.indexOf('//') === 0) continue;
      if(!keepIndent) ln = tr;
      if(tr === ''){ blank++; if(blank > 1 || ext === 'csv') continue; } else { blank = 0; }
      res.push(ln);
    }
    return capText(res.join('\n'));
  }
  function capText(t){
    if(t.length <= TEXT_MAX_CHARS) return t;
    var half = Math.floor(TEXT_MAX_CHARS / 2);
    return t.slice(0, half) + '\n...[truncated ' + (t.length - TEXT_MAX_CHARS) + ' chars]...\n' + t.slice(t.length - half);
  }

  function uploadAttachment(entry){
    var fd = new FormData();
    fd.append('file', entry.file);
    fd.append('app_id', 'atlas-ai');
    fd.append('description', 'chat attachment');
    fetch('/storage/upload', { method:'POST', body: fd })
      .then(function(r){ return r.json(); })
      .then(function(data){
        entry.uploading = false;
        if(data && data.success && data.id){
          entry.storageId = data.id;
          entry.url = '/storage/download/' + data.id;
          // اگه چت روی سرور ساخته شده، فایل رو به‌عنوان ضمیمه ثبت کن تا با حذف چت پاک بشه
          if(state.activeChatId && state.activeChatId.indexOf('local_') !== 0){
            fetch('/storage/chat/' + state.activeChatId + '/attachments', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ file_id: data.id })
            }).catch(function(){});
          }
        }
        renderAttachPreview();
      }).catch(function(){
        entry.uploading = false;
        entry.uploadFailed = true;
        renderAttachPreview();
      });
  }

  function removePendingAttachment(entry){
    var idx = pendingAttachments.indexOf(entry);
    if(idx >= 0) pendingAttachments.splice(idx, 1);
    renderAttachPreview();
  }

  function renderAttachPreview(){
    $attachPreview.innerHTML = '';
    pendingAttachments.forEach(function(entry){
      var chip = document.createElement('div');
      chip.className = 'pending-attach';
      if(entry.isImage && entry.dataUrl){
        var img = document.createElement('img');
        img.src = entry.dataUrl;
        chip.appendChild(img);
      }
      var label = document.createElement('span');
      label.textContent = entry.name;
      chip.appendChild(label);
      var st = document.createElement('span');
      st.className = 'st';
      if(entry.preparing){ st.textContent = ' ⏳ ' + t('attachPreparing'); }
      else if(entry.uploading){ st.textContent = ' ⏳ ' + t('attachUploading'); }
      else if(entry.uploadFailed){ st.textContent = ' ✗ ' + t('attachFailed'); chip.classList.add('fail'); }
      else if(entry.storageId){ st.textContent = ' ✓ ' + t('attachUploaded'); chip.classList.add('ok'); }
      chip.appendChild(st);
      var rm = document.createElement('button');
      rm.className = 'pending-attach-remove';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.addEventListener('click', function(){ removePendingAttachment(entry); });
      chip.appendChild(rm);
      $attachPreview.appendChild(chip);
    });
  }

  // ---------- Composer ----------
  $input.addEventListener('input', function(){
    $input.style.height = 'auto';
    $input.style.height = Math.min($input.scrollHeight, 200) + 'px';
  });
  $input.addEventListener('keydown', function(e){
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });
  $sendBtn.addEventListener('click', sendMessage);

  document.getElementById('new-chat-btn').addEventListener('click', function(){
    startNewChat();
    closeSidebar();
  });

  function startNewChat(){
    state.activeChatId = null;
    renderMessages([]);
    renderChatList();
    navigateToChat(null);
  }

  // ---------- URL routing: /a/chat/s/:id ----------
  function genChatId(){
    if(window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // fallback UUID v4
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
      var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
  function chatUrl(id){ return '/a/chat/s/' + id; }
  function navigateToChat(id){
    var target = id ? chatUrl(id) : '/';
    if(window.location.pathname !== target){
      window.history.pushState({ chatId: id || null }, '', target);
    }
  }
  function chatIdFromLocation(){
    var m = window.location.pathname.match(/\/a\/chat\/s\/([^\/]+)/);
    return m ? m[1] : null;
  }
  window.addEventListener('popstate', function(e){
    var id = (e.state && e.state.chatId) || chatIdFromLocation();
    openChatById(id, true);
  });
  function openChatById(id, skipNav){
    if(!id){
      state.activeChatId = null;
      renderMessages([]);
      renderChatList();
      return;
    }
    if(state.chats[id]){
      state.activeChatId = id;
      renderMessages(state.chats[id].messages || []);
      renderChatList();
      if(!skipNav) navigateToChat(id);
      if(!state.chats[id].loaded) fetchFullChat(id);
    } else {
      // چت هنوز لود نشده — تلاش برای دریافت مستقیم از سرور
      state.activeChatId = id;
      fetchFullChat(id, true);
    }
  }
  function fetchFullChat(id, createPlaceholder){
    fetch('/storage/chat/' + id)
      .then(function(r){ if(!r.ok) throw new Error('not found'); return r.json(); })
      .then(function(data){
        var msgs = applyMsgMeta(id, (data && (data.messages || data.items)) || []);
        if(!state.chats[id]){
          state.chats[id] = { id:id, title: (data && data.title) || 'گفتگو', messages: msgs, updatedAt: Date.now(), loaded:true };
        } else {
          state.chats[id].messages = msgs;
          state.chats[id].loaded = true;
        }
        if(state.activeChatId === id){
          renderMessages(msgs);
        }
        renderChatList();
      }).catch(function(){
        if(createPlaceholder){
          // نتونستیم چت رو پیدا کنیم؛ برگرد به صفحه اصلی
          state.activeChatId = null;
          renderMessages([]);
          navigateToChat(null);
        }
      });
  }

  // ---------- Rendering ----------
  function renderMessages(messages){
    $messages.innerHTML = '';
    if(!messages || messages.length === 0){
      $messages.appendChild($emptyState);
      return;
    }
    messages.forEach(function(m){ appendMessageEl(m.role, m.content, m.modelKey, m.attachments, m.refNames); });
    $messages.scrollTop = $messages.scrollHeight;
  }

  function escapeHtml(s){
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // پارس ساده‌ی محتوا به بخش‌های متن ساده و بلوک‌های کد (fenced code با سه بک‌تیک، مثل مارک‌داون)
  function renderMessageBody(bodyEl, content){
    bodyEl.innerHTML = '';
    var text = String(content == null ? '' : content);
    bodyEl.__raw = text;
    var fence = String.fromCharCode(96,96,96); // سه بک‌تیک، بدون شکستن template literal بیرونی
    var re = new RegExp(fence + '([a-zA-Z0-9_+\\-]*)\\n?([\\s\\S]*?)' + fence, 'g');
    var lastIndex = 0;
    var match;
    var found = false;
    var fileIdx = 0;
    while((match = re.exec(text)) !== null){
      found = true;
      if(match.index > lastIndex){
        appendTextChunk(bodyEl, text.slice(lastIndex, match.index));
      }
      appendCodeBlock(bodyEl, match[1] || t('codeLabel'), match[2].replace(/\n$/, ''), ++fileIdx);
      lastIndex = re.lastIndex;
    }
    if(!found){
      appendTextChunk(bodyEl, text);
    } else if(lastIndex < text.length){
      appendTextChunk(bodyEl, text.slice(lastIndex));
    }
  }

  // پارس سبک markdown خطی: bold با **، italic با تک ستاره، و کد inline با علامت تک‌کاراکتری بین‌خطی — بدون innerHTML خام
  // به‌علاوه پارس بلوکی: هدرها (#, ##, ###)، خط افقی (---)، لیست‌های نقطه‌ای و شماره‌دار، و پاراگراف‌بندی با خط خالی
  function appendTextChunk(bodyEl, text){
    if(!text) return;
    var rawLines = text.split('\n');
    var i = 0;
    var paraBuffer = [];

    function flushParagraph(){
      if(!paraBuffer.length) return;
      var p = document.createElement('p');
      p.className = 'md-p';
      renderInlineMarkdown(p, paraBuffer.join('\n'));
      bodyEl.appendChild(p);
      paraBuffer = [];
    }

    while(i < rawLines.length){
      var line = rawLines[i];
      var trimmed = line.trim();

      // خط افقی: ---  یا ***  یا ___
      if(/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)){
        flushParagraph();
        bodyEl.appendChild(document.createElement('hr')).className = 'md-hr';
        i++; continue;
      }

      // جدول markdown: خط هدر با | و خط جداکننده |---|---|
      if(trimmed.indexOf('|') >= 0 && i + 1 < rawLines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(rawLines[i + 1]) && rawLines[i + 1].indexOf('|') >= 0){
        flushParagraph();
        var splitRow = function(r){
          r = r.trim().replace(/\\\|/g, '\u0001');
          if(r.charAt(0) === '|') r = r.slice(1);
          if(r.charAt(r.length - 1) === '|') r = r.slice(0, -1);
          return r.split('|').map(function(c){ return c.replace(/\u0001/g, '|').trim(); });
        };
        var heads = splitRow(trimmed);
        var aligns = splitRow(rawLines[i + 1]).map(function(c){
          var l = c.charAt(0) === ':', r2 = c.charAt(c.length - 1) === ':';
          return l && r2 ? 'center' : (r2 ? 'right' : (l ? 'left' : ''));
        });
        var wrapT = document.createElement('div'); wrapT.className = 'md-table-wrap';
        var tbl = document.createElement('table'); tbl.className = 'md-table';
        var trh = document.createElement('tr');
        heads.forEach(function(h, ci){
          var th = document.createElement('th'); if(aligns[ci]) th.style.textAlign = aligns[ci];
          renderInlineMarkdown(th, h); trh.appendChild(th);
        });
        var thead = document.createElement('thead'); thead.appendChild(trh); tbl.appendChild(thead);
        var tbody = document.createElement('tbody');
        i += 2;
        while(i < rawLines.length && rawLines[i].indexOf('|') >= 0 && rawLines[i].trim() !== ''){
          var cells = splitRow(rawLines[i]);
          var trb = document.createElement('tr');
          for(var ci2 = 0; ci2 < heads.length; ci2++){
            var td = document.createElement('td'); if(aligns[ci2]) td.style.textAlign = aligns[ci2];
            renderInlineMarkdown(td, cells[ci2] || ''); trb.appendChild(td);
          }
          tbody.appendChild(trb);
          i++;
        }
        tbl.appendChild(tbody); wrapT.appendChild(tbl); bodyEl.appendChild(wrapT);
        continue;
      }

      // هدرها: # تا ######
      var headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if(headerMatch){
        flushParagraph();
        var level = headerMatch[1].length;
        var hEl = document.createElement('h' + Math.min(level + 2, 6)); // h3..h6 برای هماهنگی با اندازه پیام
        hEl.className = 'md-heading md-h' + level;
        renderInlineMarkdown(hEl, headerMatch[2]);
        bodyEl.appendChild(hEl);
        i++; continue;
      }

      // لیست نقطه‌ای: - یا * یا + در ابتدای خط
      if(/^([-*+])\s+/.test(trimmed) && trimmed !== '' ){
        flushParagraph();
        var ul = document.createElement('ul');
        ul.className = 'md-list';
        while(i < rawLines.length && /^([-*+])\s+/.test(rawLines[i].trim())){
          var li = document.createElement('li');
          renderInlineMarkdown(li, rawLines[i].trim().replace(/^([-*+])\s+/, ''));
          ul.appendChild(li);
          i++;
        }
        bodyEl.appendChild(ul);
        continue;
      }

      // لیست شماره‌دار: 1. 2. ...
      if(/^\d+[.)]\s+/.test(trimmed)){
        flushParagraph();
        var ol = document.createElement('ol');
        ol.className = 'md-list';
        while(i < rawLines.length && /^\d+[.)]\s+/.test(rawLines[i].trim())){
          var liO = document.createElement('li');
          renderInlineMarkdown(liO, rawLines[i].trim().replace(/^\d+[.)]\s+/, ''));
          ol.appendChild(liO);
          i++;
        }
        bodyEl.appendChild(ol);
        continue;
      }

      // خط خالی -> پایان پاراگراف فعلی
      if(trimmed === ''){
        flushParagraph();
        i++; continue;
      }

      paraBuffer.push(line);
      i++;
    }
    flushParagraph();
  }

  function makeLink(url, label){
    var a = document.createElement('a');
    a.href = url; a.textContent = label;
    a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
    return a;
  }

  function renderInlineMarkdown(container, text){
    var tickChar = String.fromCharCode(96); // بک‌تیک تکی
    var combinedRe = new RegExp(
      tickChar + '([^' + tickChar + '\\n]+)' + tickChar +           // group1: inline code
      '|\\*\\*([^\\*]+)\\*\\*' +                                     // group2: bold
      '|\\*([^\\*\\n]+)\\*' +                                         // group3: italic
      '|\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)' +                // group4,5: [text](url)
      '|(https?:\\/\\/[^\\s<>"\\]]+)',                                    // group6: bare url
      'g'
    );

    var lastIndex = 0;
    var match;
    while((match = combinedRe.exec(text)) !== null){
      if(match.index > lastIndex){
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      if(match[1] !== undefined){
        var codeEl = document.createElement('code');
        codeEl.textContent = match[1];
        container.appendChild(codeEl);
      } else if(match[2] !== undefined){
        var strongEl = document.createElement('strong');
        strongEl.textContent = match[2];
        container.appendChild(strongEl);
      } else if(match[3] !== undefined){
        var emEl = document.createElement('em');
        emEl.textContent = match[3];
        container.appendChild(emEl);
      } else if(match[4] !== undefined){
        container.appendChild(makeLink(match[5], match[4]));
      } else if(match[6] !== undefined){
        var bare = match[6], tail = '';
        var tm = bare.match(/[.,;:!?)\u060C\u061B]+$/);
        if(tm){ tail = tm[0]; bare = bare.slice(0, bare.length - tail.length); }
        container.appendChild(makeLink(bare, bare));
        if(tail) container.appendChild(document.createTextNode(tail));
      }
      lastIndex = combinedRe.lastIndex;
    }
    if(lastIndex < text.length){
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  var codeFileCounter = 0; // دیگر استفاده نمی‌شود؛ شماره‌ی فایل برای هر رندر از ۱ شروع می‌شود
  var CODE_EXT_MAP = {
    python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts', jsx:'jsx', tsx:'tsx',
    html:'html', css:'css', json:'json', java:'java', c:'c', cpp:'cpp', 'c++':'cpp', csharp:'cs', 'c#':'cs',
    php:'php', go:'go', rust:'rs', bash:'sh', shell:'sh', sh:'sh', sql:'sql', yaml:'yml', yml:'yml',
    xml:'xml', ruby:'rb', swift:'swift', kotlin:'kt', markdown:'md', md:'md', csv:'csv', text:'txt', txt:'txt'
  };
  function codeFileExt(lang){
    var l = String(lang || '').toLowerCase();
    return CODE_EXT_MAP[l] || 'txt';
  }

  function appendCodeBlock(bodyEl, lang, code, fileIdx){
    if(code.indexOf('<<<<<<< SEARCH') >= 0){ appendEditBlock(bodyEl, lang, code); return; }
    var block = document.createElement('div');
    block.className = 'code-block';

    var header = document.createElement('div');
    header.className = 'code-block-header';
    var ext = codeFileExt(lang);
    var fileName = 'atlas-code-' + (fileIdx || 1) + '.' + ext;
    var langLabel = document.createElement('span');
    langLabel.textContent = '\uD83D\uDCC4 ' + fileName;
    var dlBtn = document.createElement('button');
    dlBtn.className = 'code-copy-btn';
    dlBtn.type = 'button';
    dlBtn.textContent = '\u2B07 ' + t('downloadBtn');
    dlBtn.addEventListener('click', function(){
      try{
        var blob = new Blob([code], { type:'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
      }catch(e){}
    });
    var btnWrap = document.createElement('span');
    btnWrap.style.display = 'inline-flex'; btnWrap.style.gap = '6px';
    var copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = t('copyBtn');
    copyBtn.addEventListener('click', function(){
      copyTextToClipboard(code).then(function(){
        copyBtn.textContent = t('copiedBtn');
        copyBtn.classList.add('copied');
        setTimeout(function(){
          copyBtn.textContent = t('copyBtn');
          copyBtn.classList.remove('copied');
        }, 1600);
      });
    });
    header.appendChild(langLabel);
    btnWrap.appendChild(dlBtn);
    btnWrap.appendChild(copyBtn);
    header.appendChild(btnWrap);

    var pre = document.createElement('pre');
    var codeEl = document.createElement('code');
    codeEl.textContent = code;
    pre.appendChild(codeEl);

    block.appendChild(header);
    block.appendChild(pre);
    bodyEl.appendChild(block);
  }

  // ---------- ویرایش بخشی کد (SEARCH/REPLACE) ----------
  var appliedVersions = []; // آخرین نسخه‌های کدی که تغییر داده‌ایم (جدیدترین آخر)

  function parseEditBlocks(code){
    var out = [];
    var re = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n?([\s\S]*?)\n?>>>>>>> REPLACE/g;
    var m;
    while((m = re.exec(code)) !== null){ out.push({ search: m[1], replace: m[2] }); }
    return out;
  }
  function leadWs(l){ return (l.match(/^[ \t]*/) || [''])[0]; }
  function applyOneEdit(base, ed){
    var lines = base.split('\n');
    var sLines = ed.search.split('\n');
    while(sLines.length && sLines[0].trim() === '') sLines.shift();
    while(sLines.length && sLines[sLines.length - 1].trim() === '') sLines.pop();
    var rLines = ed.replace === '' ? [] : ed.replace.split('\n');
    if(!sLines.length){ return lines.concat(rLines).join('\n'); }
    for(var i = 0; i + sLines.length <= lines.length; i++){
      var ok = true;
      for(var j = 0; j < sLines.length; j++){
        if(lines[i + j].trim() !== sLines[j].trim()){ ok = false; break; }
      }
      if(!ok) continue;
      var delta = leadWs(lines[i]).length - leadWs(sLines[0]).length;
      var adj = rLines.map(function(l){
        if(l.trim() === '' || delta === 0) return l;
        if(delta > 0) return new Array(delta + 1).join(' ') + l;
        var w = leadWs(l).length;
        return l.slice(Math.min(w, -delta));
      });
      return lines.slice(0, i).concat(adj, lines.slice(i + sLines.length)).join('\n');
    }
    return null;
  }
  function applyEdits(base, edits){
    var cur = base;
    for(var k = 0; k < edits.length; k++){
      cur = applyOneEdit(cur, edits[k]);
      if(cur === null) return null;
    }
    return cur;
  }
  function collectBaseCandidates(){
    var cands = [];
    for(var v = appliedVersions.length - 1; v >= 0; v--) cands.push(appliedVersions[v]);
    var msgs = getActiveMessages() || [];
    var fenceRe = new RegExp(String.fromCharCode(96,96,96) + '([a-zA-Z0-9_+\\-]*)\\n?([\\s\\S]*?)' + String.fromCharCode(96,96,96), 'g');
    for(var i = msgs.length - 1; i >= 0; i--){
      var m = msgs[i];
      (m.attachments || []).forEach(function(a){ if(a.textContent) cands.push({ name:a.name, text:a.textContent }); });
      var txt = String(m.content || ''), mm;
      var found = [];
      fenceRe.lastIndex = 0;
      while((mm = fenceRe.exec(txt)) !== null){
        if(mm[2].indexOf('<<<<<<< SEARCH') < 0) found.push({ name:null, lang:mm[1], text:mm[2].replace(/\n$/, '') });
      }
      for(var f = found.length - 1; f >= 0; f--) cands.push(found[f]);
    }
    return cands;
  }

  function appendEditBlock(bodyEl, lang, code){
    var edits = parseEditBlocks(code);
    var box = document.createElement('div'); box.className = 'edit-block';
    var head = document.createElement('div'); head.className = 'edit-head';
    var title = document.createElement('span');
    title.textContent = '\u270F\uFE0F ' + t('editLabel') + ' (' + edits.length + ')';
    var btn = document.createElement('button');
    btn.className = 'code-copy-btn'; btn.type = 'button';
    btn.textContent = '\u2B07 ' + t('editApplyBtn');
    head.appendChild(title); head.appendChild(btn);
    var diff = document.createElement('pre'); diff.className = 'edit-diff';
    edits.forEach(function(ed){
      ed.search.split('\n').forEach(function(l){ var d = document.createElement('span'); d.className = 'del'; d.textContent = '- ' + l; diff.appendChild(d); });
      if(ed.replace !== '') ed.replace.split('\n').forEach(function(l){ var d = document.createElement('span'); d.className = 'add'; d.textContent = '+ ' + l; diff.appendChild(d); });
    });
    var status = document.createElement('div'); status.className = 'edit-status';
    btn.addEventListener('click', function(){
      var cands = collectBaseCandidates(), result = null, base = null;
      for(var c = 0; c < cands.length; c++){
        var cd = cands[c];
        var r = applyEdits(cd.text, edits);
        if(r !== null){ result = r; base = cd; break; }
      }
      if(result === null){ status.textContent = '\u26A0 ' + t('editNotFound'); return; }
      appliedVersions.push({ name: base.name, lang: base.lang, text: result });
      var ext = codeFileExt(base.lang || lang);
      var fname = base.name || ('atlas-edited.' + ext);
      try{
        var blob = new Blob([result], { type:'text/plain;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = fname;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
      }catch(e){}
      status.textContent = '\u2705 ' + t('editApplied') + ' \u2014 ' + fname;
    });
    box.appendChild(head); box.appendChild(diff); box.appendChild(status);
    bodyEl.appendChild(box);
  }

  function copyTextToClipboard(text){
    if(navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(text).catch(function(){ return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text){
    return new Promise(function(resolve){
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try{ document.execCommand('copy'); }catch(e){}
      document.body.removeChild(ta);
      resolve();
    });
  }

  // ---------- ذخیره‌ی محلی اطلاعات ضمیمه (اگر سرور ضمیمه‌ها را نگه نداشت، بعد از رفرش هم نمایش داده شود) ----------
  function readMetaStore(){
    try{ return JSON.parse(localStorage.getItem('atlas_msg_meta') || '{}') || {}; }catch(e){ return {}; }
  }
  function writeMetaStore(o){
    try{ localStorage.setItem('atlas_msg_meta', JSON.stringify(o)); }catch(e){
      try{ localStorage.removeItem('atlas_msg_meta'); }catch(e2){}
    }
  }
  function rememberMsgMeta(chatId, idx, msg){
    if(!chatId || idx < 0) return;
    var hasAtt = msg.attachments && msg.attachments.length;
    if(!hasAtt && !(msg.refNames && msg.refNames.length)) return;
    var o = readMetaStore();
    o[chatId] = o[chatId] || {};
    o[chatId][idx] = {
      attachments: hasAtt ? msg.attachments.map(function(a){
        return { name:a.name, mimeType:a.mimeType, isImage:a.isImage, url:a.url, storageId:a.storageId, textContent: a.textContent ? a.textContent.slice(0, 16000) : undefined };
      }) : undefined,
      refNames: msg.refNames
    };
    // فقط ۴۰ چت آخر
    var ids = Object.keys(o);
    if(ids.length > 40) delete o[ids[0]];
    writeMetaStore(o);
  }
  function moveMsgMeta(oldId, newId){
    var o = readMetaStore();
    if(o[oldId]){ o[newId] = o[oldId]; delete o[oldId]; writeMetaStore(o); }
  }
  function applyMsgMeta(chatId, msgs){
    var o = readMetaStore();
    var meta = o[chatId];
    if(!meta) return msgs;
    (msgs || []).forEach(function(m, i){
      var mm = meta[i];
      if(!mm || m.role !== 'user') return;
      if((!m.attachments || !m.attachments.length) && mm.attachments) m.attachments = mm.attachments;
      else if(m.attachments && mm.attachments){
        m.attachments.forEach(function(a, k){
          if(mm.attachments[k] && !a.textContent && mm.attachments[k].textContent) a.textContent = mm.attachments[k].textContent;
        });
      }
      if(!m.refNames && mm.refNames) m.refNames = mm.refNames;
    });
    return msgs;
  }
  function latestFileNames(){
    var msgs = getActiveMessages();
    for(var i = msgs.length - 1; i >= 0; i--){
      var at = msgs[i].attachments;
      if(msgs[i].role === 'user' && at && at.length) return at.map(function(a){ return a.name; });
    }
    return [];
  }
  function addRefNote(bodyEl, names){
    if(!names || !names.length) return;
    var n = document.createElement('div');
    n.className = 'ref-note';
    n.textContent = '\u21A9 ' + t('refNote') + ': \uD83D\uDCCE ' + names.join('\u060C ');
    bodyEl.insertBefore(n, bodyEl.firstChild);
  }

  function appendMessageEl(role, content, modelKey, attachments, refNames){
    if($messages.contains($emptyState)) $messages.removeChild($emptyState);
    var wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-wrap-' + (role === 'user' ? 'user' : 'assistant');
    var bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    if(attachments && attachments.length){
      renderAttachmentsPreview(bodyEl, attachments);
    }
    renderMessageBody(bodyEl, content);
    if(refNames && refNames.length) addRefNote(bodyEl, refNames);
    wrap.appendChild(bodyEl);
    var acts = document.createElement('div');
    acts.className = 'msg-actions';
    var cpB = document.createElement('button');
    cpB.type = 'button'; cpB.className = 'msg-act-btn'; cpB.title = t('copyBtn');
    cpB.textContent = '\uD83D\uDCCB';
    cpB.addEventListener('click', function(){
      var raw = String(bodyEl.__raw || '').replace(/^\uD83C\uDFA4 /, '');
      if(!raw) return;
      copyTextToClipboard(raw).then(function(){
        cpB.textContent = '\u2714';
        setTimeout(function(){ cpB.textContent = '\uD83D\uDCCB'; }, 1400);
      });
    });
    acts.appendChild(cpB);
    if(role === 'user'){
      var edB = document.createElement('button');
      edB.type = 'button'; edB.className = 'msg-act-btn'; edB.title = t('editMsgTitle');
      edB.textContent = '\u270F\uFE0F';
      edB.addEventListener('click', function(){
        $input.value = String(bodyEl.__raw || '').replace(/^\uD83C\uDFA4 /, '');
        $input.style.height = 'auto';
        $input.style.height = Math.min($input.scrollHeight, 200) + 'px';
        $input.focus();
      });
      acts.appendChild(edB);
    }
    wrap.appendChild(acts);
    $messages.appendChild(wrap);
    $messages.scrollTop = $messages.scrollHeight;
    return bodyEl;
  }

  function renderAttachmentsPreview(bodyEl, attachments){
    var row = document.createElement('div');
    row.className = 'attach-preview-row';
    attachments.forEach(function(att){
      if(att.isImage){
        var img = document.createElement('img');
        img.className = 'attach-preview-img';
        img.src = att.url || att.dataUrl;
        img.alt = att.name || '';
        row.appendChild(img);
      } else {
        var chip = document.createElement('a');
        chip.className = 'attach-preview-file';
        chip.textContent = '📎 ' + (att.name || 'file');
        chip.href = att.url || '#';
        chip.target = '_blank';
        chip.rel = 'noopener';
        row.appendChild(chip);
      }
    });
    bodyEl.appendChild(row);
  }

  function renderChatList(){
    $chatList.innerHTML = '';
    Object.keys(state.chats).sort(function(a,b){
      return (state.chats[b].updatedAt||0) - (state.chats[a].updatedAt||0);
    }).forEach(function(id){
      var c = state.chats[id];
      var row = document.createElement('div');
      row.className = 'chat-item-row';

      var item = document.createElement('div');
      item.className = 'chat-item' + (id === state.activeChatId ? ' active' : '');
      item.textContent = c.title || t('untitledChat');
      item.addEventListener('click', function(){
        openChatById(id);
        closeSidebar();
      });

      var delBtn = document.createElement('button');
      delBtn.className = 'chat-delete-btn';
      delBtn.type = 'button';
      delBtn.title = t('deleteChatTitle');
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', function(e){
        e.stopPropagation();
        deleteChat(id);
      });

      row.appendChild(item);
      row.appendChild(delBtn);
      $chatList.appendChild(row);
    });
  }

  function deleteChat(id){
    if(!window.confirm(t('confirmDeleteChat'))) return;
    var wasActive = (state.activeChatId === id);
    delete state.chats[id];
    renderChatList();
    if(wasActive){
      state.activeChatId = null;
      renderMessages([]);
      navigateToChat(null);
    }
    if(id.indexOf('local_') === 0) return; // فقط محلی بوده، نیازی به حذف سرور نیست
    fetch('/storage/chat/' + id, { method:'DELETE' }).catch(function(){ /* silent */ });
  }

  // ---------- Sending messages ----------
  var MAX_USER_MESSAGES_PER_CHAT = 13; // باید دقیقا با MAX_USER_MESSAGES_PER_CHAT در storage.js یکی باشه

  function sendMessage(){
    var text = $input.value.trim();
    var hasAttachments = pendingAttachments.length > 0;
    if((!text && !hasAttachments) || state.busy) return;
    if(pendingAttachments.some(function(a){ return a.preparing || a.uploading; })){
      alert(t('attachWait'));
      return;
    }

    if(!state.serverModels[state.activeModel] || !state.serverModels[state.activeModel].configured){
      alert(MODEL_LABELS[state.activeModel] + ' ' + t('modelNotConfiguredAlert'));
      return;
    }

    // محدودیت ۱۳ پیامِ کاربر در هر چت (هر چت جدید دوباره از صفر شروع میشه)
    if(state.activeChatId){
      var currentUserMsgCount = getActiveMessages().filter(function(m){ return m.role === 'user'; }).length;
      if(currentUserMsgCount >= MAX_USER_MESSAGES_PER_CHAT){
        appendMessageEl('assistant', t('chatMessageLimitReached'), state.activeModel);
        return;
      }
    }

    // ضمیمه‌های فعلی رو برای این پیام جدا می‌کنیم (حتی اگه هنوز آپلود روی سرور تمام نشده)
    var attachmentsForMessage = pendingAttachments.map(function(a){
      return { name:a.name, mimeType:a.mimeType, isImage:a.isImage, dataUrl:a.dataUrl, storageId:a.storageId, url:a.url, textContent:a.textContent };
    });
    pendingAttachments = [];
    renderAttachPreview();

    $input.value = '';
    $input.style.height = 'auto';
    var refNames = attachmentsForMessage.length ? [] : latestFileNames();
    appendMessageEl('user', text, state.activeModel, attachmentsForMessage, refNames);

    var storedMessage = { role:'user', content:text, modelKey:state.activeModel, attachments: attachmentsForMessage.map(function(a){
      return { name:a.name, mimeType:a.mimeType, isImage:a.isImage, url:a.url, storageId:a.storageId, textContent: a.textContent ? a.textContent.slice(0, 16000) : undefined };
    }) };

    if(refNames.length) storedMessage.refNames = refNames;
    if(!state.activeChatId){
      createChatRecord(text, storedMessage);
    } else {
      pushMessageToChatObj(state.activeChatId, storedMessage);
    }
    rememberMsgMeta(state.activeChatId, getActiveMessages().length - 1, storedMessage);

    var openAiUserContent = buildOpenAiContent(text, attachmentsForMessage);
    var history = getActiveMessages().slice(0, -1); // پیام کاربر همین الان اضافه شد، دوباره اضافه نکن
    var openAiMessages = history.map(function(m){
      return { role: m.role, content: m.attachments && m.attachments.length ? buildOpenAiContent(m.content, m.attachments) : m.content };
    }).concat([{ role:'user', content: openAiUserContent }]);

    var sendingModel = state.activeModel;
    state.busy = true;
    $sendBtn.disabled = true;
    var thinkStatusEl = null;
    if(sendingModel === 'star2' && state.thinkAtlasEnabled){
      thinkStatusEl = appendMessageEl('assistant', t('thinkingLabel'), sendingModel);
    }
    var typingEl = appendTyping(sendingModel);

    streamAiReply(sendingModel, openAiMessages, typingEl, thinkStatusEl);
  }

  // ---------- Streaming AI reply (SSE, کلمه به کلمه) ----------
  function streamAiReply(sendingModel, openAiMessages, typingEl, thinkStatusEl){
    var accumulated = '';
    var bodyEl = null;
    var thinkingEl = null; // تا اولین تکه‌ی متن نیاد، حباب تایپینگ رو نگه می‌داریم

    function ensureBubble(){
      if(bodyEl) return bodyEl;
      removeTyping(typingEl);
      removeTyping(thinkStatusEl);
      bodyEl = appendMessageEl('assistant', '', sendingModel);
      return bodyEl;
    }

    function updateBubble(){
      var el = ensureBubble();
      renderMessageBody(el, accumulated);
      $messages.scrollTop = $messages.scrollHeight;
    }

    function showThinkingSummary(){
      // ThinkAtlas reasoning is intentionally never rendered. The status message is enough.
      if(thinkStatusEl) return;
      thinkStatusEl = appendMessageEl('assistant', t('thinkingLabel'), sendingModel);
    }

    function finish(){
      removeTyping(thinkStatusEl);
      state.busy = false;
      $sendBtn.disabled = false;
      if(!bodyEl){
        // هیچ تکه‌ای دریافت نشد (مثلاً خطا قبل از هر chunk)
        removeTyping(typingEl);
        appendMessageEl('assistant', accumulated || t('emptyReply'), sendingModel);
      }
      pushMessageToChat(state.activeChatId, 'assistant', accumulated || t('emptyReply'), sendingModel);
    }

    function fail(err){
      removeTyping(typingEl);
      removeTyping(thinkStatusEl);
      state.busy = false;
      $sendBtn.disabled = false;
      var msg = t('errorReply') + (err && err.message ? err.message : err);
      if(bodyEl){
        accumulated += (accumulated ? '\n\n' : '') + msg;
        renderMessageBody(bodyEl, accumulated);
        pushMessageToChat(state.activeChatId, 'assistant', accumulated, sendingModel);
      } else {
        appendMessageEl('assistant', msg, sendingModel);
        pushMessageToChat(state.activeChatId, 'assistant', msg, sendingModel);
      }
    }

    function startRequest(attempt){
    return fetch('/ai/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        modelKey: sendingModel,
        messages: openAiMessages,
        stream: attempt === 0,
        ThinkAtlas: sendingModel === 'star2' && state.thinkAtlasEnabled,
      })
    }).then(function(res){
      if(!res.ok){
        return res.text().then(function(txt){
          throw new Error(txt || ('HTTP ' + res.status));
        });
      }
      var contentType = res.headers.get('Content-Type') || '';
      // اگر پاسخ واقعاً event-stream نیست (چه چون سرور بالادستی اصلاً استریم نداده، مثل مسیر
      // Vision، چه هر دلیل دیگه)، حتماً به‌صورت JSON عادی بخونش — وگرنه پارسر SSE متن رو
      // خط‌به‌خط با انتظار "data: ..." می‌خونه و خروجی خراب/بی‌معنی می‌سازه.
      if(contentType.indexOf('text/event-stream') === -1){
        return res.json().then(function(data){
          accumulated = extractReply(data);
          updateBubble();
          finish();
        });
      }
      if(!res.body || !res.body.getReader){
        // مرورگر/محیط از استریم پشتیبانی نمی‌کنه؛ به‌صورت غیر استریم بخون
        return res.json().then(function(data){
          accumulated = extractReply(data);
          updateBubble();
          finish();
        });
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder('utf-8');
      var buffer = '';
      var sawAnySseData = false;

      function pump(){
        return reader.read().then(function(result){
          if(result.done){
            // اگه اصلاً event-stream نبود (JSON خام یک‌جا اومد)، سعی کن بافر رو پارس کنی
            if(!sawAnySseData && buffer.trim()){
              try{
                var data = JSON.parse(buffer);
                accumulated = extractReply(data);
                updateBubble();
              }catch(e){ /* نادیده بگیر، هرچی تا الان جمع شده رو نشون بده */ }
            }
            finish();
            return;
          }
          buffer += decoder.decode(result.value, { stream:true });
          var lines = buffer.split('\n');
          buffer = lines.pop(); // ممکنه خط آخر ناقص باشه، برای دفعه بعد نگه‌دار

          var pendingEvent = '';
          lines.forEach(function(line){
            line = line.trim();
            if(!line) return;
            if(line.indexOf('event:') === 0){
              pendingEvent = line.slice(6).trim();
              return;
            }
            if(line.indexOf('data:') !== 0) return;
            sawAnySseData = true;
            var payload = line.slice(5).trim();
            if(payload === '[DONE]') return;
            try{
              var json = JSON.parse(payload);
              if(pendingEvent === 'atlas_thinking'){
                showThinkingSummary();
                pendingEvent = '';
                return;
              }
              pendingEvent = '';
              var delta = '';
              if(json.choices && json.choices[0]){
                var choice = json.choices[0];
                if(choice.delta && typeof choice.delta.content === 'string'){
                  delta = choice.delta.content;
                } else if(choice.message && typeof choice.message.content === 'string'){
                  delta = choice.message.content;
                } else if(typeof choice.text === 'string'){
                  delta = choice.text;
                }
              }
              if(delta){
                accumulated += delta;
                updateBubble();
              }
            }catch(e){ /* خط ناقص یا غیر JSON رو نادیده بگیر */ }
          });

          return pump();
        });
      }

      return pump();
    }).catch(function(err){
      var netErr = err && (err.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed/i.test(String(err.message || err)));
      if(netErr && attempt < 2 && !bodyEl && !accumulated){
        return new Promise(function(r){ setTimeout(r, 1200); }).then(function(){ return startRequest(attempt + 1); });
      }
      fail(err);
    });
    }
    startRequest(0);
  }

  function extractReply(data){
    try{
      if(data.choices && data.choices[0] && data.choices[0].message){
        var content = data.choices[0].message.content;
        if(content) return content;
        // پاسخ ۲۰۰ با choices معتبر ولی content خالی — سعی کن دلیل رو از finish_reason یا فیلدهای تشخیصی دیگه پیدا کنی
        var finishReason = data.choices[0].finish_reason;
        var diagNote = data.atlas_meta && data.atlas_meta.source ? (' [source: ' + data.atlas_meta.source + ']') : '';
        if(finishReason && finishReason !== 'stop'){
          return t('emptyReply') + ' (finish_reason: ' + finishReason + ')' + diagNote;
        }
        return t('emptyReply') + diagNote;
      }
      if(data.error){
        return t('genericError') + (data.error.message || JSON.stringify(data.error));
      }
      return JSON.stringify(data);
    }catch(e){
      return t('invalidResponse');
    }
  }

  function appendTyping(modelKey){
    if($messages.contains($emptyState)) $messages.removeChild($emptyState);
    var wrap = document.createElement('div');
    wrap.className = 'msg-wrap msg-wrap-assistant';
    wrap.innerHTML = '<div class="msg-body"><div class="typing"><span></span><span></span><span></span></div></div>';
    $messages.appendChild(wrap);
    $messages.scrollTop = $messages.scrollHeight;
    return wrap;
  }
  function removeTyping(el){ if(el && el.parentNode) el.parentNode.removeChild(el); }

  function getActiveMessages(){
    if(state.activeChatId && state.chats[state.activeChatId]){
      return state.chats[state.activeChatId].messages || [];
    }
    return [];
  }

  // ---------- Vision / multimodal content builder ----------
  // پیام کاربر رو به فرمت OpenAI content-parts تبدیل می‌کنه: متن + عکس‌ها (base64 data URL برای vision) + متن فایل‌های کد/متنی
  function buildOpenAiContent(text, attachments){
    if(!attachments || !attachments.length) return text;
    var parts = [];
    var extraText = '';
    attachments.forEach(function(att){
      if(att.isImage && att.dataUrl){
        parts.push({ type:'image_url', image_url:{ url: att.dataUrl } });
      } else if(att.textContent){
        extraText += '\n\n--- ' + att.name + ' ---\n' + att.textContent;
      } else if(att.name){
        extraText += '\n\n[پیوست: ' + att.name + ']';
      }
    });
    var combinedText = (text || '') + extraText;
    if(combinedText.trim()) parts.unshift({ type:'text', text: combinedText });
    return parts.length ? parts : text;
  }

  // ---------- Chat persistence via Storage API (proxied) ----------
  function createChatRecord(firstText, messageObj, extraMsgs){
    var title = (firstText && firstText.trim()) ? firstText.slice(0, 40) : (messageObj.attachments && messageObj.attachments.length ? messageObj.attachments[0].name : t('untitledChat'));
    var newId = genChatId();
    var msg = messageObj || { role:'user', content:firstText, modelKey: state.activeModel };
    var allMsgs = [msg].concat(extraMsgs || []);
    state.chats[newId] = { id: newId, title: title, messages: allMsgs, updatedAt: Date.now(), loaded:true };
    state.activeChatId = newId;
    renderChatList();
    navigateToChat(newId);

    fetch('/storage/chat/create', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        id: newId,
        title: title,
        source: (state.user && state.user.email) || 'atlas-ai',
        messages: allMsgs,
      })
    }).then(function(r){ return r.json(); })
    .then(function(data){
      // اگه سرور یه id متفاوت برگردوند (مثلاً id سفارشی رو پشتیبانی نمی‌کنه)، هماهنگ کن
      if(data && data.id && data.id !== newId){
        var chat = state.chats[newId];
        delete state.chats[newId];
        chat.id = data.id;
        moveMsgMeta(newId, data.id);
        state.chats[data.id] = chat;
        if(state.activeChatId === newId){
          state.activeChatId = data.id;
          navigateToChat(data.id);
        }
        renderChatList();
      }
      // اگه فایلی همزمان با ساخت چت آپلود شده بود، الان که id قطعی چت مشخصه ثبتش کن
      var finalId = (data && data.id) || newId;
      (msg.attachments || []).forEach(function(a){
        if(a.storageId){
          fetch('/storage/chat/' + finalId + '/attachments', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ file_id: a.storageId })
          }).catch(function(){});
        }
      });
    }).catch(function(){ /* ذخیره ابری اختیاریه؛ محلی همچنان کار می‌کنه */ });
  }

  function pushMessageToChat(chatId, role, content, modelKey){
    pushMessageToChatObj(chatId, { role:role, content:content, modelKey: modelKey || state.activeModel });
  }

  function pushMessageToChatObj(chatId, messageObj){
    if(!chatId || !state.chats[chatId]) return;
    state.chats[chatId].messages.push(messageObj);
    state.chats[chatId].updatedAt = Date.now();
    renderChatList();

    if(chatId.indexOf('local_') === 0) return; // هنوز روی سرور ساخته نشده

    fetch('/storage/chat/' + chatId + '/message', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(messageObj)
    }).catch(function(){ /* silent */ });

    (messageObj.attachments || []).forEach(function(a){
      if(a.storageId){
        fetch('/storage/chat/' + chatId + '/attachments', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ file_id: a.storageId })
        }).catch(function(){});
      }
    });
  }

  function loadChatList(){
    fetch('/storage/list?content_type=chat')
      .then(function(r){ return r.json(); })
      .then(function(data){
        var items = (data && (data.items || data.results || data.files)) || [];
        items.forEach(function(it){
          var id = it.id;
          if(!id || state.chats[id]) return;
          state.chats[id] = { id:id, title: it.title || 'گفتگو', messages: [], updatedAt: it.updatedAt || Date.now(), loaded:false };
        });
        renderChatList();
        // اگه آدرس صفحه به یه چت خاص اشاره می‌کنه، اونو باز کن
        var urlChatId = chatIdFromLocation();
        if(urlChatId) openChatById(urlChatId, true);
      }).catch(function(){ /* اگه لیست در دسترس نبود، سایلنت رد شو */ });
  }

  // ---------- Google Sign-In ----------
  function initGoogleLogin(){
    fetch('/config').then(function(r){ return r.json(); }).then(function(cfg){
      // ذخیره وضعیت مدل‌های سرور
      if(cfg.models) state.serverModels = cfg.models;

      if(!cfg.googleClientId){
        var $container = document.getElementById('google-btn-container');
        $container.innerHTML = '';
        var msg = document.createElement('p');
        msg.style.color = 'var(--text-dim)';
        msg.style.fontSize = '12px';
        msg.style.lineHeight = '1.7';
        msg.textContent = t('googleClientMissing');
        $container.appendChild(msg);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(
        document.getElementById('google-btn-container'),
        { theme:'filled_black', size:'large', shape:'pill', text:'signin_with' }
      );
    }).catch(function(){});
  }

  function parseJwt(token){
    var base64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    var json = decodeURIComponent(atob(base64).split('').map(function(c){
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(json);
  }

  function handleGoogleCredential(response){
    var payload = parseJwt(response.credential);
    state.user = {
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
    };
    localStorage.setItem('atlas_user', JSON.stringify(state.user));
    onLoginSuccess();
  }

  function onLoginSuccess(){
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('user-name').textContent = state.user.name || '';
    document.getElementById('user-email').textContent = state.user.email || '';
    document.getElementById('user-avatar').src = state.user.picture || '';
    loadChatList();
  }

  document.getElementById('signout-btn').addEventListener('click', function(){
    localStorage.removeItem('atlas_user');
    state.user = null;
    if(window.google && window.google.accounts && window.google.accounts.id){
      window.google.accounts.id.disableAutoSelect();
    }
    document.getElementById('login-overlay').classList.remove('hidden');
  });

  // ---------- Voice chat (میکروفون): ضبط -> /voice/chat -> پخش پاسخ صوتی ----------
  var $micBtn = document.getElementById('mic-btn');
  var micState = { rec:null, chunks:[], stream:null, audioEl:null };

  function stopVoicePlayback(){
    if(micState.audioEl){ try{ micState.audioEl.pause(); }catch(e){} micState.audioEl = null; }
  }
  function pickRecorderMime(){
    var cands = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'];
    for(var i=0;i<cands.length;i++){
      if(window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cands[i])) return cands[i];
    }
    return '';
  }
  function startRecording(){
    if(state.busy) return;
    if(!state.user){ return; }
    if(!navigator.mediaDevices || !window.MediaRecorder){ alert(t('micUnsupported')); return; }
    stopVoicePlayback();
    navigator.mediaDevices.getUserMedia({ audio:true }).then(function(stream){
      micState.stream = stream;
      micState.chunks = [];
      var mime = pickRecorderMime();
      var rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      micState.rec = rec;
      rec.ondataavailable = function(e){ if(e.data && e.data.size) micState.chunks.push(e.data); };
      rec.onstop = function(){
        try{ micState.stream.getTracks().forEach(function(tr){ tr.stop(); }); }catch(e){}
        var blob = new Blob(micState.chunks, { type: rec.mimeType || 'audio/webm' });
        micState.rec = null;
        $micBtn.classList.remove('recording');
        if(blob.size > 1500) sendVoice(blob);
      };
      rec.start();
      $micBtn.classList.add('recording');
    }).catch(function(){ alert(t('micDenied')); });
  }
  function stopRecording(){
    if(micState.rec && micState.rec.state !== 'inactive') micState.rec.stop();
  }
  $micBtn.addEventListener('click', function(){
    if(micState.rec) stopRecording(); else startRecording();
  });

  function sendVoice(blob){
    var sendingModel = state.activeModel;
    if(!state.serverModels[sendingModel] || !state.serverModels[sendingModel].configured){
      alert(MODEL_LABELS[sendingModel] + ' ' + t('modelNotConfiguredAlert')); return;
    }
    state.busy = true; $sendBtn.disabled = true; $micBtn.classList.add('busy');
    var typingEl = appendTyping(sendingModel);

    var hist = getActiveMessages().filter(function(m){ return typeof m.content === 'string' && m.content; })
      .slice(-8).map(function(m){ return { role:m.role, content:m.content }; });
    var fd = new FormData();
    fd.append('audio', blob, 'voice.webm');
    fd.append('modelKey', sendingModel);
    fd.append('lang', state.lang);
    fd.append('history', JSON.stringify(hist));

    function done(){ removeTyping(typingEl); state.busy = false; $sendBtn.disabled = false; $micBtn.classList.remove('busy'); }

    fetch('/voice/chat', { method:'POST', body: fd }).then(function(r){
      return r.json().then(function(d){ if(!r.ok) throw new Error((d && d.error && (d.error.message || d.error)) || ('HTTP ' + r.status)); return d; });
    }).then(function(d){
      done();
      var userText = '🎤 ' + (d.transcript || '');
      var userMsg = { role:'user', content:userText, modelKey:sendingModel };
      appendMessageEl('user', userText, sendingModel);
      var botMsg = { role:'assistant', content: d.reply || t('emptyReply'), modelKey: sendingModel };
      if(!state.activeChatId){ createChatRecord(userText, userMsg, [botMsg]); }
      else { pushMessageToChatObj(state.activeChatId, userMsg); pushMessageToChatObj(state.activeChatId, botMsg); }
      appendMessageEl('assistant', botMsg.content, sendingModel);
      if(d.audio_base64){
        var a = new Audio('data:' + (d.audio_mime || 'audio/mpeg') + ';base64,' + d.audio_base64);
        micState.audioEl = a;
        a.play().catch(function(){});
      }
    }).catch(function(err){
      done();
      appendMessageEl('assistant', t('errorReply') + (err && err.message ? err.message : err), sendingModel);
    });
  }

  // ---------- Init ----------
  function init(){
    try{
      var savedLang = localStorage.getItem('atlas_lang');
      if(savedLang === 'en' || savedLang === 'fa'){
        state.lang = savedLang;
      } else {
        // اولین باری که کاربر وارد سایت میشه (هیچ تنظیمات ذخیره‌شده‌ای نداره): پیش‌فرض انگلیسیه
        state.lang = 'en';
      }
    }catch(e){}
    applyLanguage();

    try{
      var savedTheme = localStorage.getItem('atlas_theme');
      applyTheme(savedTheme || 'modern');
    }catch(e){ applyTheme('modern'); }

    try{
      var savedThinkAtlas = localStorage.getItem('atlas_think_atlas');
      applyThinkAtlasToggle(savedThinkAtlas === '1');
    }catch(e){ try{ applyThinkAtlasToggle(false); }catch(e2){} }

    try{
      var savedUser = localStorage.getItem('atlas_user');
      if(savedUser){
        state.user = JSON.parse(savedUser);
        onLoginSuccess();
      }
    }catch(e){}

    window.addEventListener('load', function(){
      var tryInit = setInterval(function(){
        if(window.google && window.google.accounts){
          clearInterval(tryInit);
          initGoogleLogin();
        }
      }, 100);
    });
  }

  init();
})();
</script>`;

const API_DOCS_HTML_PAGE = String.raw`<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API — ATLAS AI</title>
<meta name="description" content="مستندات و دریافت کلید API رایگان ATLAS AI، سازگار با استاندارد OpenAI.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg-1: #0b1020; --bg-2: #131a33; --bg-3: #1c1440;
    --accent: #7c9cff; --accent-2: #a78bfa; --accent-3: #34d9c9;
    --text: #f3f5ff; --text-dim: #aab2d6; --text-faint: #6f79a8;
    --ok: #34d9c9; --err: #ff6b7a;
    --glass-bg: rgba(255,255,255,0.06); --glass-bg-strong: rgba(255,255,255,0.10);
    --glass-border: rgba(255,255,255,0.14); --glass-hi: rgba(255,255,255,0.22);
    --mono: 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
    --sans: 'Vazirmatn', system-ui, -apple-system, sans-serif;
    --radius-lg: 22px; --radius-md: 16px; --radius-sm: 12px;
  }
  *{ box-sizing:border-box; }
  html,body{ height:100%; }
  body{
    margin:0; min-height:100%; font-family:var(--sans); color:var(--text);
    background:
      radial-gradient(1100px 700px at 12% -10%, rgba(124,156,255,0.30), transparent 60%),
      radial-gradient(900px 600px at 110% 10%, rgba(167,139,250,0.25), transparent 55%),
      radial-gradient(1000px 800px at 50% 120%, rgba(52,217,201,0.18), transparent 55%),
      linear-gradient(160deg, var(--bg-1), var(--bg-3) 55%, var(--bg-2));
    background-attachment:fixed;
  }
  .glass{
    background:var(--glass-bg);
    -webkit-backdrop-filter: blur(22px) saturate(160%);
    backdrop-filter: blur(22px) saturate(160%);
    border:1px solid var(--glass-border);
    box-shadow: 0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .wrap{ max-width:900px; margin:0 auto; padding:48px 20px 80px; }
  header.top{ display:flex; align-items:center; justify-content:space-between; margin-bottom:40px; flex-wrap:wrap; gap:14px; }
  .brand-mark{ font-family:var(--sans); font-weight:800; font-size:19px; letter-spacing:.02em; }
  .brand-mark span{ background:linear-gradient(135deg, var(--accent), var(--accent-3)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  a.back-link{ color:var(--text-dim); text-decoration:none; font-size:13px; display:flex; align-items:center; gap:6px; }
  a.back-link:hover{ color:var(--text); }
  h1{ font-size:32px; font-weight:800; margin:0 0 10px; line-height:1.3; }
  h1 span{ background:linear-gradient(135deg, var(--accent), var(--accent-3)); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .lead{ color:var(--text-dim); font-size:15px; line-height:1.9; max-width:640px; margin:0 0 36px; }
  .card{ border-radius:var(--radius-lg); padding:28px; margin-bottom:22px; }
  .card h2{ font-size:18px; font-weight:700; margin:0 0 6px; display:flex; align-items:center; gap:10px; }
  .card .step-num{
    width:26px; height:26px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg, var(--accent), var(--accent-3)); color:#0b1020; font-size:13px; font-weight:800; flex-shrink:0;
  }
  .card p{ color:var(--text-dim); font-size:13.5px; line-height:1.9; margin:6px 0 0; }
  .btn-row{ display:flex; gap:12px; flex-wrap:wrap; margin-top:16px; }
  .btn{
    display:inline-flex; align-items:center; gap:8px;
    padding:12px 20px; border-radius:999px; font-size:13.5px; font-weight:700;
    text-decoration:none; cursor:pointer; border:1px solid var(--glass-border);
    transition:opacity .15s ease, transform .15s ease;
  }
  .btn:hover{ transform:translateY(-1px); }
  .btn-primary{ background:linear-gradient(135deg, var(--accent), var(--accent-3)); color:#0b1020; border:none; }
  .btn-primary:hover{ opacity:.92; }
  .btn-ghost{ background:var(--glass-bg); color:var(--text); }
  .btn-ghost:hover{ background:var(--glass-bg-strong); }
  code.inline{
    font-family:var(--mono); background:rgba(0,0,0,0.28); border:1px solid var(--glass-border);
    padding:2px 7px; border-radius:6px; font-size:12.5px; color:var(--accent-3);
  }
  .code-block{
    position:relative; margin-top:14px; border-radius:14px; overflow:hidden;
    background:rgba(0,0,0,0.35); border:1px solid var(--glass-border);
  }
  .code-block .code-head{
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 14px; border-bottom:1px solid var(--glass-border);
    font-size:11px; color:var(--text-faint); font-family:var(--mono);
  }
  .code-block .copy-btn{
    background:none; border:1px solid var(--glass-border); color:var(--text-dim);
    border-radius:7px; padding:5px 10px; font-size:11px; cursor:pointer; font-family:var(--sans);
  }
  .code-block .copy-btn:hover{ color:var(--text); border-color:var(--glass-hi); }
  .code-block pre{ margin:0; padding:16px; overflow-x:auto; direction:ltr; text-align:left; }
  .code-block code{ font-family:var(--mono); font-size:12.8px; line-height:1.8; color:#dbe2ff; white-space:pre; }
  .tok-kw{ color:#a78bfa; } .tok-str{ color:#34d9c9; } .tok-com{ color:#6f79a8; } .tok-fn{ color:#7c9cff; }
  table.params{ width:100%; border-collapse:collapse; margin-top:14px; font-size:13px; }
  table.params th{ text-align:right; color:var(--text-faint); font-weight:600; font-size:11.5px; padding:8px 10px; border-bottom:1px solid var(--glass-border); }
  table.params td{ padding:10px; border-bottom:1px solid rgba(255,255,255,0.06); color:var(--text-dim); vertical-align:top; }
  table.params td:first-child{ font-family:var(--mono); color:var(--text); white-space:nowrap; }
  .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:680px){ .grid-2{ grid-template-columns:1fr; } h1{ font-size:26px; } .wrap{ padding:32px 16px 60px; } }
  .badge{
    display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700;
    padding:4px 10px; border-radius:999px; background:rgba(52,217,201,0.12); color:var(--accent-3);
    border:1px solid rgba(52,217,201,0.3); margin-bottom:16px;
  }
  #api-lang-toggle-btn{
    background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:var(--radius-sm);
    color:var(--text); padding:7px 12px; font-family:var(--sans); font-weight:700; font-size:12px; cursor:pointer;
  }
  #api-lang-toggle-btn:hover{ color:var(--accent-3); border-color:var(--glass-hi); }
  footer{ text-align:center; color:var(--text-faint); font-size:12px; margin-top:50px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand-mark">ATLAS<span> AI</span></div>
    <div style="display:flex;align-items:center;gap:10px">
      <button id="api-lang-toggle-btn" title="زبان / Language">EN</button>
      <a class="back-link" id="back-link" href="/">→ بازگشت به چت</a>
    </div>
  </header>

  <span class="badge" data-i18n="badge">🟢 سازگار با استاندارد OpenAI</span>
  <h1 data-i18n="h1">دریافت کلید <span>API</span> رایگان</h1>
  <p class="lead" data-i18n="lead">با کلید API رایگان ATLAS AI می‌تونی مستقیم از هر زبان برنامه‌نویسی یا هر کتابخانه‌ی سازگار با OpenAI (مثل <code class="inline">openai-python</code>) به مدل‌های ATLAS وصل بشی — بدون نیاز به تنظیمات پیچیده.</p>

  <div class="card glass">
    <h2><span class="step-num">1</span> <span data-i18n="step1Title">ساخت کلید از طریق ربات تلگرام</span></h2>
    <p data-i18n="step1Body">وارد ربات تلگرام ATLAS AI بشو و دستور <code class="inline">/apikey</code> رو بفرست. کلید API شخصی‌ات بلافاصله برات ساخته و ارسال میشه (هر کاربر حداکثر ۲ کلید می‌تونه بسازه؛ برای دیدن یا حذف کلیدهای فعلی از /api داخل ربات استفاده کن).</p>
    <div class="btn-row">
      <a class="btn btn-primary" href="__TELEGRAM_BOT_LINK__" target="_blank" rel="noopener"><span data-i18n="openBotBtn">💬 باز کردن ربات تلگرام</span></a>
      <a class="btn btn-ghost" href="__TELEGRAM_BOT_LINK__" target="_blank" rel="noopener">/apikey</a>
    </div>
  </div>

  <div class="card glass">
    <h2><span class="step-num">2</span> <span data-i18n="step2Title">آدرس پایه (Base URL)</span></h2>
    <p data-i18n="step2Body">تمام درخواست‌ها با فرمت دقیقاً مطابق OpenAI Chat Completions، به این آدرس ارسال میشن:</p>
    <div class="code-block">
      <div class="code-head"><span>Endpoint</span><button class="copy-btn" onclick="copyCode('ep')" data-i18n="copyBtn">کپی</button></div>
      <pre><code id="ep">POST https://atlas.synapt.workers.dev/v1/chat/completions</code></pre>
    </div>
  </div>

  <div class="card glass">
    <h2><span class="step-num">3</span> <span data-i18n="step3Title">هدرها و پارامترها</span></h2>
    <table class="params">
      <tr><th data-i18n="tblHeader">هدر</th><th data-i18n="tblValue">مقدار</th></tr>
      <tr><td>Authorization</td><td>Bearer &lt;<span data-i18n="yourApiKey">کلید API شما</span>&gt;</td></tr>
      <tr><td>Content-Type</td><td>application/json</td></tr>
    </table>
    <table class="params">
      <tr><th data-i18n="tblField">فیلد بدنه</th><th data-i18n="tblDesc">توضیح</th></tr>
      <tr><td>model</td><td data-i18n="fieldModel">یکی از: Ai-2 ، Ai-3 ، STAR-1 ، STAR-2 (اگه کلیدت دسترسی همه‌ی مدل‌ها رو داشته باشه)</td></tr>
      <tr><td>messages</td><td data-i18n="fieldMessages">آرایه‌ای از پیام‌ها به فرمت <code class="inline">{role, content}</code> (role: user یا assistant)</td></tr>
      <tr><td>stream</td><td data-i18n="fieldStream">true/false — پاسخ استریم (SSE) یا یک‌جا (پیش‌فرض: false)</td></tr>
      <tr><td>ThinkAtlas</td><td data-i18n="fieldThinkAtlas">برای STAR-2 فعال شود؛ ThinkAtlas به‌صورت داخلی فکر می‌کند و فقط پاسخ نهایی را برمی‌گرداند.</td></tr>
    </table>
    <p class="hint">STAR-2 با ThinkAtlas ابتدا به‌صورت داخلی مسئله را بررسی و اعتبارسنجی می‌کند و سپس فقط پاسخ نهایی را برمی‌گرداند.</p>
  </div>

  <div class="card glass">
    <h2><span class="step-num">4</span> <span data-i18n="step4Title">نمونه‌کد پایتون (ارسال «سلام» و دریافت پاسخ)</span></h2>
    <p data-i18n="step4Body">نمونه‌ی کامل زیر رو کپی کن، کلید API خودت رو جایگزین کن، و اجرا کن — باید یک پاسخ متنی از مدل (مثلاً پاسخ به «Hello») دریافت کنی:</p>
    <div class="code-block">
      <div class="code-head"><span>python</span><button class="copy-btn" onclick="copyCode('py1')" data-i18n="copyBtn">کپی</button></div>
      <pre><code id="py1"><span class="tok-kw">import</span> requests

API_KEY = <span class="tok-str">"ATLAS-k-..."</span>  <span class="tok-com" data-i18n-comment="c1"># کلید API که از ربات تلگرام گرفتی</span>
URL = <span class="tok-str">"https://atlas.synapt.workers.dev/v1/chat/completions"</span>

response = requests.<span class="tok-fn">post</span>(
    URL,
    headers={
        <span class="tok-str">"Authorization"</span>: <span class="tok-str">f"Bearer {API_KEY}"</span>,
        <span class="tok-str">"Content-Type"</span>: <span class="tok-str">"application/json"</span>,
    },
    json={
        <span class="tok-str">"model"</span>: <span class="tok-str">"Ai-2"</span>,
        <span class="tok-str">"messages"</span>: [
            {<span class="tok-str">"role"</span>: <span class="tok-str">"user"</span>, <span class="tok-str">"content"</span>: <span class="tok-str">"hello"</span>}
        ],
        <span class="tok-str">"stream"</span>: <span class="tok-kw">False</span>,
    },
)

data = response.<span class="tok-fn">json</span>()

<span class="tok-kw">if</span> <span class="tok-str">"error"</span> <span class="tok-kw">in</span> data:
    <span class="tok-fn">print</span>(<span class="tok-str">"Error:"</span>, data[<span class="tok-str">"error"</span>][<span class="tok-str">"message"</span>])
<span class="tok-kw">else</span>:
    <span class="tok-fn">print</span>(data[<span class="tok-str">"choices"</span>][<span class="tok-str">0</span>][<span class="tok-str">"message"</span>][<span class="tok-str">"content"</span>])
<span class="tok-com" data-i18n-comment="c2"># خروجی چیزی شبیه: "سلام! چطور می‌تونم کمکتون کنم؟"</span></code></pre>
    </div>
  </div>

  <div class="card glass">
    <h2><span class="step-num">5</span> <span data-i18n="step5Title">نمونه با کتابخانه‌ی رسمی OpenAI (اختیاری)</span></h2>
    <p data-i18n="step5Body">چون فرمت خروجی کاملاً استاندارد OpenAI هست، می‌تونی از کتابخانه‌ی رسمی <code class="inline">openai</code> هم استفاده کنی، فقط <code class="inline">base_url</code> رو عوض کن:</p>
    <div class="code-block">
      <div class="code-head"><span>python</span><button class="copy-btn" onclick="copyCode('py2')" data-i18n="copyBtn">کپی</button></div>
      <pre><code id="py2"><span class="tok-kw">from</span> openai <span class="tok-kw">import</span> OpenAI

client = <span class="tok-fn">OpenAI</span>(
    api_key=<span class="tok-str">"ATLAS-k-..."</span>,
    base_url=<span class="tok-str">"https://atlas.synapt.workers.dev/v1"</span>,
)

response = client.chat.completions.<span class="tok-fn">create</span>(
    model=<span class="tok-str">"Ai-2"</span>,
    messages=[{<span class="tok-str">"role"</span>: <span class="tok-str">"user"</span>, <span class="tok-str">"content"</span>: <span class="tok-str">"hello"</span>}],
)

<span class="tok-fn">print</span>(response.choices[<span class="tok-str">0</span>].message.content)</code></pre>
    </div>
  </div>

  <footer data-i18n="footer">ATLAS AI · توسعه‌یافته توسط BYTERNET</footer>
</div>
<script>
  var API_DOCS_I18N = {
    fa: {
      badge: '🟢 سازگار با استاندارد OpenAI',
      h1: 'دریافت کلید <span>API</span> رایگان',
      lead: 'با کلید API رایگان ATLAS AI می‌تونی مستقیم از هر زبان برنامه‌نویسی یا هر کتابخانه‌ی سازگار با OpenAI (مثل <code class="inline">openai-python</code>) به مدل‌های ATLAS وصل بشی — بدون نیاز به تنظیمات پیچیده.',
      step1Title: 'ساخت کلید از طریق ربات تلگرام',
      step1Body: 'وارد ربات تلگرام ATLAS AI بشو و دستور <code class="inline">/apikey</code> رو بفرست. کلید API شخصی‌ات بلافاصله برات ساخته و ارسال میشه (هر کاربر حداکثر ۲ کلید می‌تونه بسازه؛ برای دیدن یا حذف کلیدهای فعلی از /api داخل ربات استفاده کن).',
      openBotBtn: '💬 باز کردن ربات تلگرام',
      step2Title: 'آدرس پایه (Base URL)',
      step2Body: 'درخواست‌ها با فرمت دقیقاً مطابق OpenAI Chat Completions، به هر کدام از این دو آدرس معتبر قابل ارسال هستن (هر دو یک نتیجه می‌دن، برای Redundancy می‌تونی از هرکدوم استفاده کنی):',
      copyBtn: 'کپی',
      step3Title: 'هدرها و پارامترها',
      tblHeader: 'هدر', tblValue: 'مقدار', tblField: 'فیلد بدنه', tblDesc: 'توضیح',
      yourApiKey: 'کلید API شما',
      fieldModel: 'یکی از: Ai-2 ، Ai-3 ، STAR-1 ، STAR-2 (اگه کلیدت دسترسی همه‌ی مدل‌ها رو داشته باشه)',
      fieldMessages: 'آرایه‌ای از پیام‌ها به فرمت <code class="inline">{role, content}</code> (role: user یا assistant)',
      fieldStream: 'true/false — پاسخ استریم (SSE) یا یک‌جا (پیش‌فرض: false)',
      fieldThinkAtlas: 'برای STAR-2 فعال شود؛ ThinkAtlas به‌صورت داخلی فکر می‌کند و فقط پاسخ نهایی را برمی‌گرداند.',
      step4Title: 'نمونه‌کد پایتون (ارسال «سلام» و دریافت پاسخ)',
      step4Body: 'نمونه‌ی کامل زیر رو کپی کن، کلید API خودت رو جایگزین کن، و اجرا کن — باید یک پاسخ متنی از مدل (مثلاً پاسخ به «Hello») دریافت کنی:',
      c1: '# کلید API که از ربات تلگرام گرفتی',
      c1b: '',
      c2: '# خروجی چیزی شبیه: "سلام! چطور می‌تونم کمکتون کنم؟"',
      step5Title: 'نمونه با کتابخانه‌ی رسمی OpenAI (اختیاری)',
      step5Body: 'چون فرمت خروجی کاملاً استاندارد OpenAI هست، می‌تونی از کتابخانه‌ی رسمی <code class="inline">openai</code> هم استفاده کنی، فقط <code class="inline">base_url</code> رو عوض کن:',
      footer: 'ATLAS AI · توسعه‌یافته توسط BYTERNET',
      backLink: '→ بازگشت به چت',
    },
    en: {
      badge: '🟢 OpenAI-compatible',
      h1: 'Get your free <span>API</span> key',
      lead: 'With a free ATLAS AI API key you can connect directly from any programming language or any OpenAI-compatible library (like <code class="inline">openai-python</code>) to ATLAS models — no complex setup needed.',
      step1Title: 'Create a key via the Telegram bot',
      step1Body: 'Open the ATLAS AI Telegram bot and send <code class="inline">/apikey</code>. Your personal API key is generated and sent instantly (each user can create up to 2 keys; use /api inside the bot to view or delete your current keys).',
      openBotBtn: '💬 Open Telegram bot',
      step2Title: 'Base URL',
      step2Body: 'Requests, in a format exactly matching OpenAI Chat Completions, can be sent to either of these two valid endpoints (both return the same result — use whichever you like for redundancy):',
      copyBtn: 'Copy',
      step3Title: 'Headers & parameters',
      tblHeader: 'Header', tblValue: 'Value', tblField: 'Body field', tblDesc: 'Description',
      yourApiKey: 'your API key',
      fieldModel: 'One of: Ai-2, Ai-3, STAR-1, STAR-2 (if your key has access to all models)',
      fieldMessages: 'Array of messages in <code class="inline">{role, content}</code> format (role: user or assistant)',
      fieldStream: 'true/false — streamed (SSE) or single response (default: false)',
      fieldThinkAtlas: 'For STAR-2, enable ThinkAtlas to reason internally before the final answer. The private reasoning is never returned.',
      step4Title: 'Python example (send "hello", get a reply)',
      step4Body: 'Copy the full example below, replace it with your own API key, and run it — you should get a text reply from the model (e.g. a reply to "Hello"):',
      c1: '# API key you got from the Telegram bot',
      c1b: '',
      c2: '# Output looks something like: "Hello! How can I help you?"',
      step5Title: 'Example with the official OpenAI library (optional)',
      step5Body: 'Since the response format is fully OpenAI-standard, you can also use the official <code class="inline">openai</code> library — just change the <code class="inline">base_url</code>:',
      footer: 'ATLAS AI · developed by BYTERNET',
      backLink: '→ Back to chat',
    },
  };
  function applyApiDocsLang(lang){
    var dict = API_DOCS_I18N[lang] || API_DOCS_I18N.fa;
    document.documentElement.lang = (lang === 'en') ? 'en' : 'fa';
    document.documentElement.dir = (lang === 'en') ? 'ltr' : 'rtl';
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var key = el.getAttribute('data-i18n');
      if(dict[key] !== undefined) el.innerHTML = dict[key];
    });
    document.querySelectorAll('[data-i18n-comment]').forEach(function(el){
      var key = el.getAttribute('data-i18n-comment');
      if(dict[key] !== undefined) el.textContent = dict[key];
    });
    var backLink = document.getElementById('back-link');
    if(backLink) backLink.textContent = dict.backLink;
    var langBtn = document.getElementById('api-lang-toggle-btn');
    if(langBtn) langBtn.textContent = (lang === 'en') ? 'FA' : 'EN';
    try{ localStorage.setItem('atlas_lang', lang); }catch(e){}
  }
  function copyCode(id){
    var el = document.getElementById(id);
    var text = el.innerText || el.textContent;
    navigator.clipboard && navigator.clipboard.writeText(text).catch(function(){});
  }
  (function initApiDocsLang(){
    var saved = null;
    try{ saved = localStorage.getItem('atlas_lang'); }catch(e){}
    var lang = (saved === 'en' || saved === 'fa') ? saved : 'en';
    applyApiDocsLang(lang);
    var btn = document.getElementById('api-lang-toggle-btn');
    if(btn){
      btn.addEventListener('click', function(){
        applyApiDocsLang((document.documentElement.lang === 'en') ? 'fa' : 'en');
      });
    }
  })();
</script>
</body>
</html>`;