import {
  IMG_MAX_SIDE, IMG_QUALITY, IMG_SKIP_BELOW_BYTES, MAX_ATTACH_BYTES, TEXT_MAX_CHARS, THUMB_SIDE,
} from './config';
import type { Attachment } from './types';

export class FileError extends Error {
  constructor(public code: 'tooLarge' | 'unsupported' | 'unreadable') { super(code); }
}

// Memory-only stores (too big for localStorage). They live for the current session:
// - compressed image data URLs that are sent to the model
// - the untouched text of attached files, used as the base when applying edits
const imageStore = new Map<string, string>();
const originalTextStore = new Map<string, string>();
export const getImageData = (id: string) => imageStore.get(id);
export const getOriginalText = (id: string) => originalTextStore.get(id);

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'env', 'log', 'sql',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte',
  'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'sh', 'bat', 'ps1', 'gradle', 'properties',
]);
const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-javascript|typescript|x-sh|x-yaml|yaml|sql))/;

const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function estimateTokens(text: string) {
  let ascii = 0;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) < 128) ascii += 1;
  return Math.ceil(ascii / 4 + (text.length - ascii) / 2);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new FileError('unreadable'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall back to <img> below */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new FileError('unreadable')); img.src = url; });
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

function drawJpeg(source: CanvasImageSource, w: number, h: number, maxSide: number, quality: number) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale)); const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new FileError('unreadable');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cw, ch); // JPEG has no alpha
  ctx.drawImage(source, 0, 0, cw, ch);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Same recipe as the website: max 1024 px, JPEG 0.7; GIF/SVG and tiny files are left alone. */
async function processImage(file: File): Promise<Attachment> {
  const id = uid();
  const original = await readAsDataUrl(file);
  let sent = original; let mime = file.type || 'image/jpeg'; let thumb: string | undefined;
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(file);
    thumb = drawJpeg(decoded.source, decoded.width, decoded.height, THUMB_SIDE, 0.6);
    const skip = /image\/(gif|svg)/.test(file.type) || (file.size < IMG_SKIP_BELOW_BYTES && Math.max(decoded.width, decoded.height) <= IMG_MAX_SIDE);
    if (!skip) {
      const out = drawJpeg(decoded.source, decoded.width, decoded.height, IMG_MAX_SIDE, IMG_QUALITY);
      if (out.length < original.length) { sent = out; mime = 'image/jpeg'; }
    }
  } catch { /* keep the original image if anything fails */ }
  finally { decoded?.close(); }
  imageStore.set(id, sent);
  const name = mime === 'image/jpeg' ? file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : file.name;
  return { id, name, mime, isImage: true, originalSize: file.size, sentSize: Math.round((sent.length - sent.indexOf(',') - 1) * 0.75), thumb };
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= TEXT_MAX_CHARS) return { text, truncated: false };
  const half = Math.floor(TEXT_MAX_CHARS / 2);
  return { text: `${text.slice(0, half)}\n...[truncated ${text.length - TEXT_MAX_CHARS} chars]...\n${text.slice(-half)}`, truncated: true };
}

/** Fewer tokens for the model: no trailing spaces, no double blank lines, no whole-line comments. */
export function minifyText(name: string, raw: string): { text: string; truncated: boolean } {
  const ext = extOf(name);
  const text = raw.replace(/\r\n?/g, '\n');
  if (ext === 'json') { try { return capText(JSON.stringify(JSON.parse(text))); } catch { /* not valid JSON: treat as text */ } }
  const hashLang = ['py', 'sh', 'rb', 'yml', 'yaml', 'toml', 'ps1'].includes(ext);
  const slashLang = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'swift', 'scss', 'less', 'gradle'].includes(ext);
  const keepIndent = ['py', 'yml', 'yaml', 'md', 'markdown', 'txt', 'csv', 'tsv', 'toml', 'ini', 'html', 'htm', 'xml', 'vue', 'svelte', 'sql', 'log'].includes(ext);
  const out: string[] = []; let blank = 0;
  for (const line of text.split('\n')) {
    const trimmedEnd = line.replace(/\s+$/, ''); const trimmed = trimmedEnd.trim();
    if (hashLang && trimmed.startsWith('#') && !trimmed.startsWith('#!')) continue;
    if (slashLang && trimmed.startsWith('//')) continue;
    if (trimmed === '') { blank += 1; if (blank > 1 || ext === 'csv' || ext === 'tsv') continue; } else blank = 0;
    out.push(keepIndent ? trimmedEnd : trimmed);
  }
  return capText(out.join('\n'));
}

async function processText(file: File): Promise<Attachment> {
  const raw = await file.text();
  const id = uid();
  originalTextStore.set(id, raw);
  const { text, truncated } = minifyText(file.name, raw);
  return { id, name: file.name, mime: file.type || 'text/plain', isImage: false, originalSize: file.size, sentSize: new Blob([text]).size, text, truncated };
}

export const isImageFile = (file: File) => file.type.startsWith('image/');
export const isTextFile = (file: File) => TEXT_MIME.test(file.type) || TEXT_EXT.has(extOf(file.name));

export async function processFile(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACH_BYTES) throw new FileError('tooLarge');
  if (isImageFile(file)) return processImage(file);
  if (isTextFile(file)) return processText(file);
  throw new FileError('unsupported');
}
