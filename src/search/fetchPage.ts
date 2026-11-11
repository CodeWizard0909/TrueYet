import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

/**
 * Fetches a page and returns its readable text. Pricing and limits come from
 * page text, never from search snippets, which are often stale or truncated.
 */
export async function fetchPageText(url: string, opts: { timeoutMs?: number; maxChars?: number } = {}): Promise<string | null> {
  const { timeoutMs = 6000, maxChars = 6000 } = opts;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; chat-agent/0.1)', accept: 'text/html' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const html = await res.text();
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document).parse();
    const text = (article?.textContent ?? document.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}
