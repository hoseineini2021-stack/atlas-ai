import { API_URL } from './config';
import type { ApiMessage } from './history';

export class ChatError extends Error {
  constructor(public code: 'invalidKey' | 'http' | 'noStream' | 'network', public status = 0, public detail = '') { super(code); }
}

type Options = {
  apiKey: string;
  model: string; // e.g. "star-2"
  messages: ApiMessage[];
  stream: boolean;
  think: boolean;
  signal: AbortSignal;
  onDelta: (text: string) => void;
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

/** One request to the Atlas API. Streams text through onDelta and returns the full reply. */
async function attempt(opts: Options, stream: boolean): Promise<string> {
  const body: Record<string, unknown> = { model: opts.model, messages: opts.messages, stream };
  // Only Star-2 can think; the flag is sent explicitly so the server never turns it on by default.
  if (opts.model === 'star-2') body.ThinkAtlas = opts.think;
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) throw response.status === 401 ? new ChatError('invalidKey', 401) : new ChatError('http', response.status, await errorDetail(response));

  const isSse = (response.headers.get('Content-Type') || '').includes('text/event-stream');
  if (!stream || !isSse) {
    // Some paths (e.g. image requests) answer with plain JSON even when streaming was requested.
    const text = extractText(await response.json());
    if (text) opts.onDelta(text);
    return text;
  }
  if (!response.body) throw new ChatError('noStream');

  const reader = response.body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let full = ''; let pendingEvent = '';
  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;
    if (line.startsWith('event:')) { pendingEvent = line.slice(6).trim(); return; }
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    const event = pendingEvent; pendingEvent = '';
    if (data === '[DONE]') return;
    try {
      const json = JSON.parse(data);
      if (event === 'atlas_thinking') { opts.onThinking(); return; }
      const delta = extractText(json);
      if (delta) { full += delta; opts.onDelta(delta); }
    } catch { /* incomplete record */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    lines.forEach(handleLine);
  }
  if (buffer.trim()) handleLine(buffer);
  if (!full && buffer.trim().startsWith('{')) { try { const text = extractText(JSON.parse(buffer)); if (text) { full = text; opts.onDelta(text); } } catch { /* ignore */ } }
  return full;
}

export async function requestChat(opts: Options): Promise<string> {
  let received = false;
  const wrapped: Options = { ...opts, onDelta: (t) => { received = true; opts.onDelta(t); } };
  for (let tryNumber = 0; ; tryNumber += 1) {
    try {
      return await attempt(wrapped, opts.stream && tryNumber === 0);
    } catch (error) {
      if ((error as DOMException).name === 'AbortError' || error instanceof ChatError) throw error;
      // Network hiccup before anything arrived: retry quietly (non-streaming) like the website does.
      if (received || tryNumber >= 2) throw new ChatError('network');
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
}
