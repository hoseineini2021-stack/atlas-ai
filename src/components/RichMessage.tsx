import { memo, useState, type ReactNode } from 'react';
import { Check, Code2, Copy as CopyIcon, Download, PencilLine } from 'lucide-react';
import type { Copy } from '../i18n';
import { applyEdits, hasEditBlocks, parseEditBlocks, rememberApplied, type BaseCandidate } from '../lib/patch';
import { saveTextFile } from '../lib/save';

const EXT: Record<string, string> = {
  python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', jsx: 'jsx', tsx: 'tsx', html: 'html', css: 'css',
  json: 'json', java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', csharp: 'cs', 'c#': 'cs', php: 'php', go: 'go', rust: 'rs',
  bash: 'sh', shell: 'sh', sh: 'sh', sql: 'sql', yaml: 'yml', yml: 'yml', xml: 'xml', ruby: 'rb', swift: 'swift', kotlin: 'kt',
  markdown: 'md', md: 'md', csv: 'csv', text: 'txt', txt: 'txt',
};

// ---------- inline markdown ----------
const INLINE = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|https?:\/\/[^\s<>"\]]+)/g;
const linkClass = 'break-all font-semibold text-blue-600 underline decoration-blue-300 underline-offset-4 transition hover:text-violet-600 dark:text-blue-300';

function InlineText({ text }: { text: string }) {
  return <>{text.split(INLINE).map((part, index) => {
    const key = `${index}-${part.slice(0, 8)}`;
    if (!part) return null;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (link) return <a key={key} href={link[2]} target="_blank" rel="noreferrer" className={linkClass}>{link[1]}</a>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={key} className="font-extrabold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={key} dir="ltr" className="rounded-md bg-slate-900/8 px-1.5 py-0.5 font-mono text-[0.86em] text-violet-700 dark:bg-white/10 dark:text-violet-200">{part.slice(1, -1)}</code>;
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^https?:\/\//.test(part)) {
      const tail = part.match(/[.,;:!?)\u060C\u061B]+$/)?.[0] ?? ''; const url = part.slice(0, part.length - tail.length);
      return <span key={key}><a href={url} target="_blank" rel="noreferrer" dir="ltr" className={linkClass}>{url}</a>{tail}</span>;
    }
    return <span key={key}>{part}</span>;
  })}</>;
}

// ---------- block markdown (headings, lists, quotes, rules, tables) ----------
const SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const splitRow = (row: string) => {
  let r = row.trim().replace(/\\\|/g, '\u0001');
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|')) r = r.slice(0, -1);
  return r.split('|').map((c) => c.replace(/\u0001/g, '|').trim());
};
const alignOf = (cell: string): 'left' | 'right' | 'center' | undefined => {
  const l = cell.startsWith(':'); const r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : undefined;
};

function Table({ lines }: { lines: string[] }) {
  const heads = splitRow(lines[0]); const aligns = splitRow(lines[1]).map(alignOf); const rows = lines.slice(2).map(splitRow);
  return <div className="my-3 max-w-full overflow-x-auto rounded-2xl border border-slate-300/70 bg-white/40 shadow-sm dark:border-white/12 dark:bg-white/4" role="region" tabIndex={0}>
    <table className="w-full min-w-full border-collapse text-[13.5px] leading-6" dir="auto">
      <thead><tr className="bg-indigo-500/12 dark:bg-indigo-400/14">{heads.map((h, i) => <th key={i} style={{ textAlign: aligns[i] }} className="whitespace-nowrap border-b border-slate-300/70 px-3 py-2.5 text-start font-extrabold dark:border-white/12"><InlineText text={h} /></th>)}</tr></thead>
      <tbody>{rows.map((cells, r) => <tr key={r} className="odd:bg-transparent even:bg-slate-900/[0.035] dark:even:bg-white/[0.04]">{heads.map((_, c) => <td key={c} style={{ textAlign: aligns[c] }} className="min-w-24 max-w-64 break-words border-t border-slate-200/70 px-3 py-2 align-top dark:border-white/8"><InlineText text={cells[c] ?? ''} /></td>)}</tr>)}</tbody>
    </table>
  </div>;
}

const HEADING = /^(#{1,6})\s+(.+)$/; const UL = /^[-*+]\s+/; const OL = /^\d+[.)]\s+/;

function MarkdownSegment({ text }: { text: string }) {
  const lines = text.split('\n'); const blocks: ReactNode[] = []; let i = 0;
  while (i < lines.length) {
    const line = lines[i]; const trimmed = line.trim();
    if (!trimmed) { i += 1; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push(<hr key={`hr-${i}`} className="my-3 border-slate-300/70 dark:border-white/12" />); i += 1; continue; }
    if (trimmed.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && SEPARATOR.test(lines[i + 1])) {
      const start = i; i += 2; while (i < lines.length && lines[i].trim() && lines[i].includes('|')) i += 1;
      blocks.push(<Table key={`table-${start}`} lines={lines.slice(start, i)} />); continue;
    }
    const heading = trimmed.match(HEADING);
    if (heading) {
      const level = heading[1].length; const size = level === 1 ? 'text-xl font-black leading-8' : level === 2 ? 'text-lg font-extrabold leading-7' : 'text-base font-extrabold leading-7';
      blocks.push(<h3 key={`h-${i}`} className={`mt-1 ${size}`}><InlineText text={heading[2]} /></h3>); i += 1; continue;
    }
    if (trimmed.startsWith('>')) {
      const quote: string[] = []; while (i < lines.length && lines[i].trim().startsWith('>')) { quote.push(lines[i].trim().replace(/^>\s?/, '')); i += 1; }
      blocks.push(<blockquote key={`q-${i}`} className="my-2 border-s-2 border-violet-400/80 ps-3 text-slate-600 dark:text-slate-300"><InlineText text={quote.join('\n')} /></blockquote>); continue;
    }
    if (UL.test(trimmed)) {
      const items: string[] = []; while (i < lines.length && UL.test(lines[i].trim())) { items.push(lines[i].trim().replace(UL, '')); i += 1; }
      blocks.push(<ul key={`ul-${i}`} className="my-2 list-disc space-y-1 ps-5 marker:text-violet-500">{items.map((it, n) => <li key={n}><InlineText text={it} /></li>)}</ul>); continue;
    }
    if (OL.test(trimmed)) {
      const items: string[] = []; while (i < lines.length && OL.test(lines[i].trim())) { items.push(lines[i].trim().replace(OL, '')); i += 1; }
      blocks.push(<ol key={`ol-${i}`} className="my-2 list-decimal space-y-1 ps-5 marker:font-bold marker:text-violet-500">{items.map((it, n) => <li key={n}><InlineText text={it} /></li>)}</ol>); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i].trim()) && !lines[i].trim().startsWith('>') && !UL.test(lines[i].trim()) && !OL.test(lines[i].trim())
      && !(lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && SEPARATOR.test(lines[i + 1]))) { para.push(lines[i]); i += 1; }
    blocks.push(<p key={`p-${i}`} className="whitespace-pre-wrap break-words"><InlineText text={para.join('\n')} /></p>);
  }
  return <>{blocks}</>;
}

// ---------- fenced code ----------
type Segment = { type: 'text'; text: string } | { type: 'code'; lang: string; code: string };

/** Also understands a code block that is still being streamed (no closing fence yet). */
function splitFences(content: string): Segment[] {
  const out: Segment[] = []; let i = 0;
  while (i < content.length) {
    const open = content.indexOf('```', i);
    if (open < 0) { out.push({ type: 'text', text: content.slice(i) }); break; }
    if (open > i) out.push({ type: 'text', text: content.slice(i, open) });
    const nl = content.indexOf('\n', open + 3);
    if (nl < 0) { out.push({ type: 'code', lang: content.slice(open + 3).trim().split(/\s/)[0] ?? '', code: '' }); break; }
    const lang = content.slice(open + 3, nl).trim().split(/\s/)[0] ?? '';
    const close = content.indexOf('```', nl + 1);
    if (close < 0) { out.push({ type: 'code', lang, code: content.slice(nl + 1) }); break; }
    out.push({ type: 'code', lang, code: content.slice(nl + 1, close).replace(/\n$/, '') }); i = close + 3;
  }
  return out;
}

type Shared = { copy: Copy; copiedId: string | null; onCopy: (value: string, id: string) => void; getBases: () => BaseCandidate[]; notify: (message: string) => void };

function CodeBlock({ lang, code, id, shared, index }: { lang: string; code: string; id: string; shared: Shared; index: number }) {
  const { copy, copiedId, onCopy, notify } = shared;
  const fileName = `atlas-code-${index}.${EXT[lang.toLowerCase()] ?? 'txt'}`;
  const done = copiedId === id;
  return <div className="my-3 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-800/80 bg-[#12131d] text-left shadow-inner">
    <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2" dir="ltr">
      <span className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold text-slate-300"><Code2 size={15} className="shrink-0 text-cyan-300" />{lang || copy.code}</span>
      <span className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={() => void saveTextFile(fileName, code).catch(() => notify(copy.saveFailed))} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300"><Download size={14} />{copy.download}</button>
        <button type="button" onClick={() => onCopy(code, id)} className="flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300">{done ? <Check size={14} className="text-emerald-300" /> : <CopyIcon size={14} />}{done ? '✓' : copy.copy}</button>
      </span>
    </div>
    <pre dir="ltr" className="max-w-full min-w-0 overflow-x-auto p-4 text-left text-[13px] leading-6 text-slate-100"><code className="whitespace-pre-wrap break-words sm:whitespace-pre sm:break-normal">{code}</code></pre>
  </div>;
}

function EditBlock({ lang, code, shared }: { lang: string; code: string; shared: Shared }) {
  const { copy, getBases, notify } = shared; const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const edits = parseEditBlocks(code);
  const apply = async () => {
    for (const base of getBases()) {
      const result = applyEdits(base.text, edits);
      if (result === null) continue;
      const name = base.name || `atlas-edited.${EXT[(base.lang || lang).toLowerCase()] ?? 'txt'}`;
      rememberApplied({ name, lang: base.lang || lang, text: result });
      setStatus({ ok: true, text: `${copy.editApplied} — ${name}` });
      try { await saveTextFile(name, result); } catch { notify(copy.saveFailed); }
      return;
    }
    setStatus({ ok: false, text: copy.editNotFound });
  };
  return <div className="my-3 min-w-0 max-w-full overflow-hidden rounded-2xl border border-amber-400/40 bg-amber-50/60 text-left dark:border-amber-300/25 dark:bg-amber-400/8">
    <div className="flex items-center justify-between gap-2 border-b border-amber-400/30 px-3 py-2" dir="ltr">
      <span className="flex items-center gap-1.5 text-xs font-extrabold text-amber-800 dark:text-amber-200"><PencilLine size={15} />{copy.editLabel} ({edits.length})</span>
      <button type="button" onClick={() => void apply()} disabled={!edits.length} className="flex min-h-8 items-center gap-1.5 rounded-lg bg-amber-500/90 px-2.5 text-xs font-extrabold text-white transition hover:bg-amber-500 disabled:opacity-40"><Download size={14} />{copy.editApply}</button>
    </div>
    <pre dir="ltr" className="max-h-72 max-w-full overflow-auto p-3 text-[12.5px] leading-5">{edits.map((e, n) => <span key={n} className="block">
      {e.search.split('\n').map((l, k) => <span key={`d${k}`} className="block bg-rose-500/12 text-rose-700 dark:text-rose-300">- {l}</span>)}
      {e.replace !== '' && e.replace.split('\n').map((l, k) => <span key={`a${k}`} className="block bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">+ {l}</span>)}
    </span>)}</pre>
    {status && <p className={`px-3 pb-2.5 text-xs font-bold ${status.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>{status.ok ? '✅' : '⚠️'} {status.text}</p>}
  </div>;
}

type Props = Shared & { content: string; messageId: string };

function RichMessageBase({ content, messageId, ...shared }: Props) {
  let codeIndex = 0;
  return <div className="space-y-2">{splitFences(content).map((segment, n) => {
    if (segment.type === 'text') return <MarkdownSegment key={`t-${n}`} text={segment.text} />;
    codeIndex += 1;
    return hasEditBlocks(segment.code)
      ? <EditBlock key={`e-${n}`} lang={segment.lang} code={segment.code} shared={shared} />
      : <CodeBlock key={`c-${n}`} lang={segment.lang} code={segment.code} id={`code-${messageId}-${n}`} index={codeIndex} shared={shared} />;
  })}</div>;
}

export const RichMessage = memo(RichMessageBase);
