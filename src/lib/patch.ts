// SEARCH/REPLACE edits: the model sends small diffs, the app applies them to the original file.
export type Edit = { search: string; replace: string };
export type BaseCandidate = { name?: string | null; lang?: string; text: string };

// Versions produced by edits applied during this session (newest last), so edits can be chained.
const appliedVersions: BaseCandidate[] = [];
export const rememberApplied = (v: BaseCandidate) => { appliedVersions.push(v); };
export const getAppliedVersions = () => [...appliedVersions].reverse();

export const hasEditBlocks = (code: string) => code.includes('<<<<<<< SEARCH');

export function parseEditBlocks(code: string): Edit[] {
  const out: Edit[] = []; const re = /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n?([\s\S]*?)\n?>>>>>>> REPLACE/g; let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push({ search: m[1], replace: m[2] });
  return out;
}

const lead = (l: string) => (l.match(/^[ \t]*/) ?? [''])[0];

function applyOne(base: string, edit: Edit): string | null {
  const lines = base.split('\n'); const search = edit.search.split('\n');
  while (search.length && search[0].trim() === '') search.shift();
  while (search.length && search[search.length - 1].trim() === '') search.pop();
  const replace = edit.replace === '' ? [] : edit.replace.split('\n');
  if (!search.length) return [...lines, ...replace].join('\n');
  for (let i = 0; i + search.length <= lines.length; i += 1) {
    if (!search.every((s, j) => lines[i + j].trim() === s.trim())) continue;
    const delta = lead(lines[i]).length - lead(search[0]).length;
    const adjusted = replace.map((l) => {
      if (l.trim() === '' || delta === 0) return l;
      return delta > 0 ? ' '.repeat(delta) + l : l.slice(Math.min(lead(l).length, -delta));
    });
    return [...lines.slice(0, i), ...adjusted, ...lines.slice(i + search.length)].join('\n');
  }
  return null;
}

export function applyEdits(base: string, edits: Edit[]): string | null {
  let current: string | null = base;
  for (const edit of edits) { current = applyOne(current, edit); if (current === null) return null; }
  return current;
}
