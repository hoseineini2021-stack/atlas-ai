import type { Conversation } from './types';

export const KEYS = {
  conversations: 'atlas-conversations',
  activeChat: 'atlas-active-chat',
  legacyMessages: 'atlas-chat-messages',
  apiKey: 'atlas-api-key',
  stream: 'atlas-stream-enabled',
  theme: 'atlas-theme-mode',
  language: 'atlas-language',
  model: 'atlas-model',
  think: 'atlas-think-enabled',
  tokenSaver: 'atlas-token-saver',
  autoPlay: 'atlas-voice-autoplay',
} as const;

export function readBool(key: string, fallback: boolean) {
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}

export function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

/**
 * Saves the conversations. Attachments carry thumbnails and file text, so on a full
 * storage we progressively drop the heaviest parts instead of losing the whole save.
 */
export function persistConversations(conversations: Conversation[]) {
  const sorted = [...conversations];
  const clean = sorted.map((c) => ({ ...c, messages: c.messages.filter((m) => m.status !== 'streaming') }));
  const newestId = [...clean].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
  const strip = (keepText: boolean, keepThumb: boolean) => clean.map((c) => ({
    ...c,
    messages: c.messages.map((m) => !m.attachments?.length ? m : ({
      ...m,
      attachments: m.attachments.map((a) => ({
        ...a,
        text: keepText || c.id === newestId ? a.text : undefined,
        thumb: keepThumb ? a.thumb : undefined,
      })),
    })),
  }));
  const attempts: Conversation[][] = [
    clean,
    strip(false, true),
    strip(false, false),
    [...strip(false, false)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30),
  ];
  for (const attempt of attempts) {
    if (safeSet(KEYS.conversations, JSON.stringify(attempt))) return;
  }
}
