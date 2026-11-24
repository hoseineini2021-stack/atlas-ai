import { API_URL } from './config';
import type { ApiMessage } from './history';

export class ChatError extends Error {
  constructor(public code: 'invalidKey' | 'http' | 'noStream' | 'network', public status = 0, public detail = '') { super(code); }
}

type Options = {
  apiKey: string;
  model: string;
  messages: ApiMessage[];
  stream: boolean;
  think: boolean;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReset: () => void;
  onThinking: () => void;
};

function extractText(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string }; text?: string }> } | null)?.choices?.[0];
  return choice?.delta?.content ?? choice?.message?.content ?? choice?.text ?? '';
}

async function errorDetail(response: Response) {
  try {
    const raw = await response.text();
    try { const json = JSON.parse(raw); const msg = json?.error?.message ?? json?.error ?? json?.message; if (typeof msg === 'string') return msg.slice(0, 300); } catch { /* not JSON */ }
    return raw.slice(0, 200);
  } catch { return ''; }
}

/** One request to Atlas. A broken/incomplete SSE stream is surfaced instead of silently accepted as a complete answer. */
async function attempt(opts: Options, stream: boolean): Promise<string> {
  const body: Record<string, unknown> = { model: opts.model, messages: opts.messages, stream };
  if (opts.model === 'star-2') body.ThinkAtlas = opts.think;
  // Long prompts and replies may take minutes. Avoid short client timeouts.
  const requestController = new AbortController();
  const abortFromCaller = () => requestController.abort(opts.signal.reason);
  opts.signal.addEventListener('abort', abortFromCaller, { once: true });
  const requestTimeout = window.setTimeout(() => requestController.abort(new Error('Request timeout')), 300_000);
  let response: Response;
  try {
    response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` }, body: JSON.stringify(body), signal: requestController.signal });
  } catch (error) {
    if (requestController.signal.aborted && !opts.signal.aborted) throw new ChatError('network', 0, 'درخواست پس از ۵ دقیقه متوقف شد؛ لطفاً دوباره تلاش کنید.');
    throw error;
  } finally { window.clearTimeout(requestTimeout); opts.signal.removeEventListener('abort', abortFromCaller); }
  if (!response.ok) throw response.status === 401 ? new ChatError('invalidKey', 401) : new ChatError('http', response.status, await errorDetail(response));

  const isSse = (response.headers.get('Content-Type') || '').toLowerCase().includes('text/event-stream');
  if (!stream || !isSse) {
    const text = extractText(await response.json());
    if (text) opts.onDelta(text);
    return text;
  }
  if (!response.body) throw new ChatError('noStream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let eventName = '';
  let dataLines: string[] = [];
  let sawDone = false;
  let sawFinish = false;
  let streamError = '';

  const dispatch = () => {
    if (!dataLines.length) { eventName = ''; return; }
    const data = dataLines.join('\n').trim();
    const event = eventName;
    dataLines = [];
    eventName = '';
    if (data === '[DONE]') { sawDone = true; return; }
    let payload: any;
    try { payload = JSON.parse(data); }
    catch { streamError = 'The server sent malformed streaming data.'; return; }
    if (event === 'atlas_thinking') { opts.onThinking(); return; }
    if (payload?.error) {
      const error = payload.error;
      streamError = typeof error === 'string' ? error : (error.message || 'The model stream returned an error.');
      return;
    }
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason) sawFinish = true;
    const delta = extractText(payload);
    if (delta) { full += delta; opts.onDelta(delta); }
  };

  const consumeLine = (line: string) => {
    if (line === '') { dispatch(); return; }
    if (line.startsWith(':')) return; // SSE comment/heartbeat
    if (line.startsWith('event:')) { eventName = line.slice(6).trim(); return; }
    if (line.startsWith('data:')) { dataLines.push(line.slice(5).replace(/^ /, '')); return; }
  };

  const abortPromise = new Promise<never>((_, reject) => {
    if (opts.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    else opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    while (true) {
      if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let timeoutId: number | undefined;
      const stallTimeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new ChatError('network', 0, 'Stream stalled for 60 seconds; retrying without streaming.')), 60_000); });
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try { readResult = await Promise.race([reader.read(), stallTimeout, abortPromise]; } finally { if (timeoutId !== undefined) window.clearTimeout(timeoutId); }
      const { done, value } = readResult;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
      if (streamError) throw new ChatError('network', 0, streamError);
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
    dispatch();
    if (streamError) throw new ChatError('network', 0, streamError);
    if (!sawDone && !sawFinish) {
      throw new ChatError('network', 0, 'The stream ended before a completion event. The displayed text is only a partial answer.');
    }
    return full;
  } catch (error) {
    if (opts.signal.aborted) { try { await reader.cancel(); } catch { /* stream already closed */ } throw new DOMException('Aborted', 'AbortError'); }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function requestChat(opts: Options): Promise<string> {
  let received = false;
  const wrapped: Options = { ...opts, onDelta: (t) => { received = true; opts.onDelta(t); } };
  for (let tryNumber = 0; ; tryNumber += 1) {
    try {
      return await attempt(wrapped, opts.stream && tryNumber === 0);
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') throw error;
      if (opts.stream && tryNumber === 0 && error instanceof ChatError && error.code === 'network'
          && /stream ended before a completion event|partial answer|stream stalled/i.test(error.detail)) {
        // A dropped/stalled SSE stream may leave a partial answer. Reset and retry once non-streaming.
        opts.onReset();
        received = false;
        return await attempt(wrapped, false);
      }
      if (error instanceof ChatError) throw error;
      if (received || tryNumber >= 2) throw new ChatError('network');
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
}
