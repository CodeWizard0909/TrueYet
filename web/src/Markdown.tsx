import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { SourceRef } from '../../src/agent/events.ts';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Renders the agent's markdown, turning [n] citations into links to their sources. */
export function Markdown({ text, sources }: { text: string; sources: SourceRef[] }) {
  const html = useMemo(() => {
    const byN = new Map(sources.map((s) => [s.n, s]));
    // Models sometimes write [1, 2]; normalise to [1][2] before linking.
    const normalised = text.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_m, list: string) =>
      list.split(/\s*,\s*/).map((n) => `[${n}]`).join(''),
    );
    const withCites = normalised.replace(/\[(\d+)\](?!\()/g, (match, n: string) => {
      const s = byN.get(Number(n));
      if (!s) return match;
      const title = s.title.replace(/["<>]/g, '');
      return `<a class="cite" href="${s.url.replace(/"/g, '%22')}" title="${title}">${n}</a>`;
    });
    const safe = DOMPurify.sanitize(marked.parse(withCites, { async: false, gfm: true }));
    // Recheck tables: turn the Status cell into a coloured badge.
    return safe.replace(
      // A citation may follow the status word ("Changed [4]"); keep it after the badge.
      /<td>\s*(?:<strong>)?\s*(Changed|Unchanged|Unverified|Not verified|Couldn(?:'|’|&#39;)t verify)\s*(?:<\/strong>)?\s*((?:<a class="cite"[^>]*>\d+<\/a>\s*)*)<\/td>/gi,
      (_m, word: string, cites: string) => {
        const kind = /^changed$/i.test(word) ? 'changed' : /^unchanged$/i.test(word) ? 'same' : 'unknown';
        return `<td><span class="verdict verdict-${kind}">${word}</span>${cites ? ` ${cites.trim()}` : ''}</td>`;
      },
    );
  }, [text, sources]);

  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
