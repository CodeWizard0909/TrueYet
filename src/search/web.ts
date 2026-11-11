import type { Memory } from '../memory/store.ts';
import { braveProvider } from './brave.ts';
import { exaProvider } from './exa.ts';
import { fetchPageText } from './fetchPage.ts';
import type { SearchProvider, SearchQuery, SearchResult } from './types.ts';
import { TIMEOUTS, withTimeout } from '../lib/timeout.ts';

export interface WebSearchDeps {
  /** Tried in order; the first one that succeeds wins. */
  providers: SearchProvider[];
  memory: Memory;
  fetchPage?: (url: string) => Promise<string | null>;
  /** How long a cached result stays fresh. Prices move slowly; an hour is a good trade-off. */
  ttlMs?: number;
  /** How many snippet-only results get their full page fetched. */
  fetchTop?: number;
}

export function createWebSearch(deps: WebSearchDeps) {
  const { providers, memory, fetchPage = fetchPageText, ttlMs = 60 * 60_000, fetchTop = 3 } = deps;

  return {
    async search(q: SearchQuery, signal?: AbortSignal): Promise<SearchResult[]> {
      const key = cacheKey(q);
      const cached = memory.cacheGet(key);
      if (cached) return JSON.parse(cached) as SearchResult[];

      const errors: string[] = [];
      for (const provider of providers) {
        try {
          const results = await withPageText(await provider.search(q, withTimeout(TIMEOUTS.search, signal)), fetchPage, fetchTop);
          memory.cacheSet(key, JSON.stringify(results), ttlMs);
          return results;
        } catch (err) {
          if (signal?.aborted) throw err;
          errors.push(`${provider.name}: ${(err as Error).message}`);
        }
      }
      throw new Error(`All search providers failed (${errors.join('; ') || 'none configured'})`);
    },
  };
}

export type WebSearch = ReturnType<typeof createWebSearch>;

/** Providers from the environment: Exa first, Brave as fallback. */
export function providersFromEnv(env = process.env): SearchProvider[] {
  const providers: SearchProvider[] = [];
  if (env.EXA_API_KEY) providers.push(exaProvider(env.EXA_API_KEY));
  if (env.BRAVE_API_KEY) providers.push(braveProvider(env.BRAVE_API_KEY));
  return providers;
}

async function withPageText(
  results: SearchResult[],
  fetchPage: (url: string) => Promise<string | null>,
  fetchTop: number,
): Promise<SearchResult[]> {
  return Promise.all(
    results.map(async (r, i) => {
      if (r.text || i >= fetchTop) return r;
      const text = await fetchPage(r.url);
      return text ? { ...r, text } : r;
    }),
  );
}

function cacheKey(q: SearchQuery): string {
  return JSON.stringify([
    q.query.trim().toLowerCase().replace(/\s+/g, ' '),
    q.since?.toISOString().slice(0, 10) ?? null,
    q.maxResults ?? null,
    [...(q.domains ?? [])].sort(),
  ]);
}
