# ATLAS AI — v1.5 (Android / Capacitor)

اپ اندروید ATLAS AI (React + Vite + Capacitor). نسخه‌ی ۱.۵ قابلیت‌های سایت (`atlas_ai-site-V4`) را به اپ آورده است.

## تازه‌های v1.5

| قابلیت | توضیح |
| --- | --- |
| **مدل Star-2 + فکر کردن** | مدل `Star-2` به لیست اضافه شد. وقتی انتخاب باشد، دکمه‌ی «تفکر عمیق» (ThinkAtlas) ظاهر می‌شود. هنگام فکر کردن نشانگر «در حال فکر کردن…» دیده می‌شود (خودِ استدلال هرگز نمایش داده نمی‌شود، مثل سایت). |
| **جدول** | جدول‌های Markdown (هدر، ترازبندی ستون، اسکرول افقی، راست‌به‌چپ)، لینک `[متن](آدرس)`، خط جداکننده و تیترهای ۱ تا ۶. |
| **ارسال عکس و فایل (فشرده)** | عکس: حداکثر ۱۰۲۴ پیکسل، JPEG با کیفیت ۰٫۷ (مثل سایت). فایل متنی/کد: حذف فاصله‌ی اضافه، خط خالی تکراری و کامنت‌های تک‌خطی، سقف ۲۴٬۰۰۰ کاراکتر. حداکثر ۴ پیوست و ۲۰ مگابایت. اندازه‌ی قبل و بعد از فشرده‌سازی و تعداد توکن تقریبی روی هر پیوست نشان داده می‌شود. |
| **بخش صوت** | دکمه‌ی میکروفون (وقتی کادر پیام خالی است) ← ضبط تک‌کاناله با بیت‌ریت پایین ← متن گفتار + پاسخ + پخش صدا. پخش خودکار قابل خاموش شدن است و هر پاسخ دکمه‌ی «پخش» دارد. حداکثر ۱۲۰ ثانیه. |
| **توکن ورودی کمتر، سرعت بیشتر** | «صرفه‌جویی هوشمند توکن» (پیش‌فرض روشن): فقط ۱۶ پیام آخر و سقف حجم برای تاریخچه، عکس‌های قدیمی حذف، فایل‌های قدیمی کوتاه، پاسخ‌های خیلی بلند قدیمی بریده می‌شوند. پیام آخر و دو فایل آخر همیشه کامل فرستاده می‌شوند تا دقت پایین نیاید. پرامپت سیستمی هم فشرده شده است. |
| **ویرایش بخشی کد (SEARCH/REPLACE)** | وقتی مدل فقط تغییرات را می‌دهد، دکمه‌ی «اعمال و ذخیره فایل» تغییرات را روی فایل اصلی اعمال می‌کند. روی اندروید فایل از طریق منوی اشتراک‌گذاری ذخیره می‌شود. هر بلوک کد هم دکمه‌ی «ذخیره» دارد. |
| **سرعت رابط** | به‌روزرسانی پاسخ استریم حداکثر ~۲۰ بار در ثانیه، ذخیره‌سازی با تأخیر (نه با هر تکه)، و بلوک کدِ نیمه‌تمام هم در حین استریم درست نمایش داده می‌شود. |

## ساخت APK (بدون Android Studio)

مثل قبل: ریپازیتوری ← Actions ← **Build ATLAS AI APK** ← Run workflow ← دانلود artifact با نام `ATLAS-AI-v1.5-debug-apk`.
یک مرحله‌ی جدید (`scripts/patch-android.mjs`) خودکار مجوز میکروفون را به پروژه‌ی اندروید اضافه می‌کند و نسخه را 1.5 (versionCode 15) می‌گذارد.

## تنظیم سمت سرور (Worker) — برای صوت

اپ برای صوت اول به `https://atlas.synapt.workers.dev/v1/voice/chat` با **کلید شخصی کاربر** درخواست می‌دهد.
Worker فعلی این مسیر را ندارد؛ فایل `worker/atlas_ai-site-V4.1-voice-proxy.js` همان Worker سایت (V4) است با یک مسیر و یک تابع اضافه (`proxyVoiceToBotServer`) و بقیه‌ی کد دست‌نخورده. اگر این مسیر در دسترس نباشد (۴۰۱/۴۰۳/۴۰۴/۴۰۵)، اپ خودکار به مسیر `/voice/chat` خودِ سایت برمی‌گردد.
همچنین سرور بات (`/v1/voice/chat` روی PythonAnywhere) باید کلید کاربر را برای صوت بپذیرد؛ در غیر این‌صورت فقط fallback کار می‌کند.

## توسعه‌ی محلی

```bash
npm install
npm run dev
npm run build
```

## ساختار کد

```
src/App.tsx                 رابط اصلی، چت، صوت، پیوست
src/i18n.ts                 متن‌های فارسی/انگلیسی
src/components/RichMessage  Markdown، جدول، کد، ویرایش SEARCH/REPLACE
src/components/Attachments  نمایش پیوست‌ها
src/lib/config.ts           آدرس‌ها و محدودیت‌ها (همه‌ی عددها اینجا)
src/lib/chat.ts             درخواست و استریم SSE (event: atlas_thinking)
src/lib/files.ts            فشرده‌سازی عکس و فایل
src/lib/history.ts          ساخت پیام‌ها با کمترین توکن
src/lib/voice.ts            ضبط و ارسال صدا، پخش
src/lib/patch.ts, bases.ts  اعمال SEARCH/REPLACE
src/lib/save.ts             ذخیره‌ی فایل (وب و اندروید)
```

## English summary

v1.5 brings the website features to the Android app: Star-2 with a Thinking toggle, tables/links/headings, compressed image & file attachments (1024 px JPEG 0.7, minified text), a voice section (record → transcript + reply + audio), token-saving history, SEARCH/REPLACE code edits with save/share, and a smoother streaming UI. See the Persian notes above for build and Worker details.

Never commit a real API key. The key is entered in Settings and stored only on the device.
