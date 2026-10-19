import { getOriginalText } from './files';
import { getAppliedVersions, hasEditBlocks, type BaseCandidate } from './patch';
import type { ChatMessage } from './types';

/** Possible "original files" for SEARCH/REPLACE edits: earlier patched versions, attached files, then code from the chat. */
export function collectBases(messages: ChatMessage[]): BaseCandidate[] {
  const out: BaseCandidate[] = [...getAppliedVersions()];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    m.attachments?.forEach((a) => { const text = getOriginalText(a.id) ?? a.text; if (text) out.push({ name: a.name, text }); });
    const found: BaseCandidate[] = []; const re = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g; let match: RegExpExecArray | null;
    while ((match = re.exec(m.content)) !== null) if (!hasEditBlocks(match[2])) found.push({ name: null, lang: match[1], text: match[2].replace(/\n$/, '') });
    out.push(...found.reverse());
  }
  return out;
}
