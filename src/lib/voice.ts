import { VOICE_MAX_SECONDS, VOICE_MIN_BYTES, VOICE_TIMEOUT_MS, VOICE_URL, VOICE_URL_FALLBACK } from './config';
import type { Language } from './types';

export class VoiceError extends Error {
  constructor(public code: 'unsupported' | 'denied' | 'failed', public detail = '') { super(code); }
}

export const voiceSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

function pickMime() {
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(mime)) return mime;
  }
  return '';
}

export type Recorder = { stop: () => Promise<Blob | null>; cancel: () => void };

/** Records mono, low-bitrate speech (small upload = faster answer). Auto-stops after VOICE_MAX_SECONDS. */
export async function startRecording(onAutoStop: () => void): Promise<Recorder> {
  if (!voiceSupported()) throw new VoiceError('unsupported');
  let stream: MediaStream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
  catch { throw new VoiceError('denied'); }
  const mime = pickMime();
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const timer = window.setTimeout(onAutoStop, VOICE_MAX_SECONDS * 1000);
  recorder.start();
  return {
    stop: () => new Promise((resolve) => {
      window.clearTimeout(timer);
      if (recorder.state === 'inactive') { release(); resolve(null); return; }
      recorder.onstop = () => { release(); const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); resolve(blob.size >= VOICE_MIN_BYTES ? blob : null); };
      recorder.stop();
    }),
    cancel: () => { window.clearTimeout(timer); recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); release(); },
  };
}

// Model names the voice endpoints understand (same mapping as the website's worker).
const VOICE_MODEL: Record<string, string> = { 'ai-2': 'Ai-2', 'ai-3': 'Ai-3', 'star-1': 'STAR-1', 'star-2': 'STAR-1' };
const SITE_KEY: Record<string, string> = { 'ai-2': 'ai2', 'ai-3': 'ai3', 'star-1': 'star1', 'star-2': 'star2' };

export type VoiceResult = { transcript: string; reply: string; audioUrl?: string };

type VoiceRequest = { blob: Blob; apiKey: string; model: string; lang: Language; history: { role: string; content: string }[]; signal: AbortSignal };

async function post(url: string, form: FormData, apiKey: string | null, outer: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer.addEventListener('abort', abort);
  const timer = window.setTimeout(abort, VOICE_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', body: form, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined, signal: controller.signal });
  } finally { window.clearTimeout(timer); outer.removeEventListener('abort', abort); }
}

async function readError(res: Response) {
  try { const raw = await res.text(); try { const j = JSON.parse(raw); const m = j?.error?.message ?? j?.error ?? j?.message; if (typeof m === 'string') return m.slice(0, 200); } catch { /* plain */ } return raw.slice(0, 160) || `HTTP ${res.status}`; }
  catch { return `HTTP ${res.status}`; }
}

export async function sendVoice(req: VoiceRequest): Promise<VoiceResult> {
  const history = JSON.stringify(req.history.slice(-8));
  const build = (modelField: [string, string]) => {
    const form = new FormData();
    form.append('audio', req.blob, req.blob.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    form.append(modelField[0], modelField[1]); form.append('lang', req.lang); form.append('history', history);
    return form;
  };
  // 1) the public endpoint with the user's own key; 2) the website endpoint if it is missing / not allowed.
  let res = await post(VOICE_URL, build(['model', VOICE_MODEL[req.model] ?? 'Ai-2']), req.apiKey, req.signal);
  if ([401, 403, 404, 405].includes(res.status)) res = await post(VOICE_URL_FALLBACK, build(['modelKey', SITE_KEY[req.model] ?? 'ai2']), null, req.signal);
  if (!res.ok) throw new VoiceError('failed', await readError(res));
  const data = await res.json() as { transcript?: string; reply?: string; audio_base64?: string; audio_mime?: string; error?: unknown };
  return {
    transcript: (data.transcript ?? '').trim(),
    reply: (data.reply ?? '').trim(),
    audioUrl: data.audio_base64 ? `data:${data.audio_mime || 'audio/mpeg'};base64,${data.audio_base64}` : undefined,
  };
}

// ---- Playback (one voice at a time) ----
let current: HTMLAudioElement | null = null;
export function stopPlayback() { if (current) { current.pause(); current = null; } }
export function playAudio(url: string, onEnd: () => void): Promise<void> {
  stopPlayback();
  const audio = new Audio(url); current = audio;
  const finish = () => { if (current === audio) current = null; onEnd(); };
  audio.onended = finish; audio.onerror = finish;
  return audio.play().catch(finish);
}
