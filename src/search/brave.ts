import type { SearchProvider, SearchQuery, SearchResult } from './types.ts';

interface BraveResponse {
  web?: { results?: { title: string; url: string; description?: string; page_age?: string }[] };
}

/** Brave returns snippets only; the web search layer fetches page text for the top results. */
export function braveProvider(apiKey: string): SearchProvider {
  return {
    name: 'brave',
    async search(q: SearchQuery, signal?: AbortSignal): Promise<SearchResult[]> {
      const site = q.domains?.length ? ` ${q.domains.map((d) => `site:${d}`).join(' OR ')}` : '';
      const params = new URLSearchParams({ q: q.query + site, count: String(q.maxResults ?? 6) });
      if (q.since) params.set('freshness', `${q.since.toISOString().slice(0, 10)}to${new Date().toISOString().slice(0, 10)}`);

      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: { accept: 'application/json', 'x-subscription-token': apiKey },
        signal,
      });
      if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
      const data = (await res.json()) as BraveResponse;
      return (data.web?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: stripTags(r.description ?? ''),
        publishedAt: r.page_age,
        provider: 'brave',
      }));
    },
  };
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '');
