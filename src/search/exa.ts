import type { SearchProvider, SearchQuery, SearchResult } from './types.ts';

interface ExaResponse {
  results?: { title?: string; url: string; publishedDate?: string; text?: string; summary?: string }[];
}

/** Exa returns page text with results, so we usually skip a separate page fetch. https://docs.exa.ai */
// `lite` is Exa's low-latency mode for chat (it replaced the legacy `fast`/`instant`).
export function exaProvider(apiKey: string, type = process.env.EXA_SEARCH_TYPE ?? 'lite'): SearchProvider {
  return {
    name: 'exa',
    async search(q: SearchQuery, signal?: AbortSignal): Promise<SearchResult[]> {
      const res = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        signal,
        body: JSON.stringify({
          query: q.query,
          type,
          numResults: q.maxResults ?? 6,
          ...(q.since && { startPublishedDate: q.since.toISOString() }),
          ...(q.domains?.length && { includeDomains: q.domains }),
          contents: { text: { maxCharacters: 4000 } },
        }),
      });
      if (!res.ok) throw new Error(`Exa search failed: ${res.status} ${await res.text().catch(() => '')}`.trim());
      const data = (await res.json()) as ExaResponse;
      return (data.results ?? []).map((r) => ({
        title: r.title ?? r.url,
        url: r.url,
        snippet: (r.summary ?? r.text ?? '').slice(0, 300),
        text: r.text,
        publishedAt: r.publishedDate,
        provider: 'exa',
      }));
    },
  };
}
