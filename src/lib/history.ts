import {
  HISTORY_CHAR_BUDGET, HISTORY_MAX_MESSAGES, IMAGE_KEEP_WINDOW, OLD_ASSISTANT_CAP, OLD_FILE_PREVIEW_CHARS, SYSTEM_PROMPT,
} from './config';
import { getImageData } from './files';
import type { Attachment, ChatMessage } from './types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ApiMessage = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

type FileMode = 'full' | 'preview';

/** Turns a message + its attachments into OpenAI-style content parts (same shape the website sends). */
function toContent(text: string, attachments: Attachment[] | undefined, keepImages: boolean, fileMode: FileMode): string | ContentPart[] {
  if (!attachments?.length) return text;
  const parts: ContentPart[] = []; let extra = '';
  for (const a of attachments) {
    if (a.isImage) {
      const data = keepImages ? getImageData(a.id) : undefined;
      if (data) parts.push({ type: 'image_url', image_url: { url: data } });
      else extra += `\n\n[Image: ${a.name}${keepImages ? ' — no longer available, ask the user to attach it again' : ''}]`;
    } else if (a.text) {
      const body = fileMode === 'full' || a.text.length <= OLD_FILE_PREVIEW_CHARS
        ? a.text
        : `${a.text.slice(0, OLD_FILE_PREVIEW_CHARS)}\n...[older file, shortened to save tokens]...`;
      extra += `\n\n--- ${a.name} ---\n${body}`;
    } else extra += `\n\n[File: ${a.name}]`;
  }
  const combined = `${text}${extra}`.trim();
  if (combined) parts.unshift({ type: 'text', text: combined });
  return parts.length ? parts : text;
}

const approxLength = (content: string | ContentPart[]) =>
  typeof content === 'string' ? content.length : content.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : 800), 0);

/**
 * Builds the messages for one request.
 * tokenSaver = true (default): short history window, older images dropped, older files shortened,
 * very long old answers capped. The newest user message is always sent in full, so accuracy stays.
 * tokenSaver = false: the whole conversation is sent as-is.
 */
export function buildRequestMessages(messages: ChatMessage[], tokenSaver: boolean, isWelcome: (m: ChatMessage) => boolean): ApiMessage[] {
  const usable = messages.filter((m) => !isWelcome(m) && m.status !== 'error' && (m.content.trim() || m.attachments?.length));
  const clean = (m: ChatMessage) => m.content.replace(/^🎤\s*/, '');

  if (!tokenSaver) {
    return [{ role: 'system', content: SYSTEM_PROMPT }, ...usable.map((m): ApiMessage => ({ role: m.role, content: toContent(clean(m), m.attachments, true, 'full') }))];
  }

  const lastIndex = usable.length - 1;
  const userWithImages = usable.map((m, i) => (m.role === 'user' && m.attachments?.some((a) => a.isImage) ? i : -1)).filter((i) => i >= 0);
  const userWithFiles = usable.map((m, i) => (m.role === 'user' && m.attachments?.some((a) => a.text) ? i : -1)).filter((i) => i >= 0);
  const lastImageIdx = userWithImages.at(-1) ?? -1;
  const fullFileIdx = new Set(userWithFiles.slice(-2)); // the two newest messages with files keep full text

  const picked: ApiMessage[] = []; let chars = 0;
  for (let i = lastIndex; i >= 0; i -= 1) {
    const m = usable[i];
    const keepImages = i === lastImageIdx && lastIndex - i < IMAGE_KEEP_WINDOW;
    let text = clean(m);
    if (m.role === 'assistant' && i !== lastIndex && text.length > OLD_ASSISTANT_CAP) text = `${text.slice(0, OLD_ASSISTANT_CAP)}\n...[shortened]`;
    const content = toContent(text, m.attachments, keepImages, fullFileIdx.has(i) ? 'full' : 'preview');
    const size = approxLength(content);
    const isNewest = i === lastIndex;
    if (!isNewest && (picked.length >= HISTORY_MAX_MESSAGES || chars + size > HISTORY_CHAR_BUDGET)) break;
    picked.unshift({ role: m.role, content }); chars += size;
  }
  while (picked.length > 1 && picked[0].role === 'assistant') picked.shift();
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...picked];
}
