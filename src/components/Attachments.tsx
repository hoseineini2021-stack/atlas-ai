import { FileText, Loader2, X } from 'lucide-react';
import type { Copy } from '../i18n';
import { estimateTokens, formatBytes } from '../lib/files';
import type { Attachment, PendingAttachment } from '../lib/types';

const kTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function detail(a: Attachment, copy: Copy) {
  if (a.isImage) return a.sentSize < a.originalSize * 0.95 ? `${formatBytes(a.originalSize)} → ${formatBytes(a.sentSize)}` : formatBytes(a.sentSize);
  return `≈ ${kTokens(estimateTokens(a.text ?? ''))} ${copy.tokens}${a.truncated ? ` · ${copy.truncatedFile}` : ''}`;
}

/** Chip shown above the composer for each file the user is about to send. */
export function PendingChips({ items, copy, onRemove }: { items: PendingAttachment[]; copy: Copy; onRemove: (id: string) => void }) {
  if (!items.length) return null;
  return <div className="mx-auto mb-2 flex w-full max-w-3xl gap-2 overflow-x-auto pb-1">{items.map((a) => <div key={a.id} className={`flex min-w-0 max-w-[15rem] shrink-0 items-center gap-2 rounded-2xl border p-1.5 pe-2 text-xs ${a.status === 'error' ? 'border-rose-300/60 bg-rose-50/70 dark:border-rose-400/25 dark:bg-rose-500/10' : 'border-indigo-200/70 bg-white/60 dark:border-white/12 dark:bg-white/6'}`}>
    {a.thumb ? <img src={a.thumb} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-500/12 text-indigo-600 dark:text-indigo-300">{a.status === 'processing' ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}</span>}
    <span className="min-w-0 flex-1"><strong className="block truncate font-bold" dir="auto">{a.name}</strong><span className="block truncate text-slate-500 dark:text-slate-400">{a.status === 'processing' ? copy.preparing : a.status === 'error' ? copy.unreadableFile : detail(a, copy)}</span></span>
    <button type="button" onClick={() => onRemove(a.id)} className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-500/10 hover:text-rose-500" aria-label={copy.removeAttachment}><X size={15} /></button>
  </div>)}</div>;
}

/** Attachments inside a sent message. */
export function MessageAttachments({ items, copy }: { items: Attachment[]; copy: Copy }) {
  if (!items.length) return null;
  return <div className="mb-2 flex flex-wrap gap-2">{items.map((a) => a.thumb
    ? <img key={a.id} src={a.thumb} alt={a.name} className="max-h-40 max-w-[11rem] rounded-2xl border border-white/30 object-cover shadow-sm" />
    : <span key={a.id} className="inline-flex max-w-full items-center gap-2 rounded-xl bg-white/20 px-2.5 py-1.5 text-xs font-bold"><FileText size={15} className="shrink-0" /><span className="truncate" dir="auto">{a.name}</span><span className="shrink-0 opacity-80">{a.isImage ? copy.imageWord : `≈${kTokens(estimateTokens(a.text ?? ''))} ${copy.tokens}`}</span></span>)}</div>;
}
