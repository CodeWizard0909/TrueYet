import { describe, expect, it } from 'vitest';
import { createWebSearch } from './web.ts';
import { openMemory } from '../memory/store.ts';
import type { SearchProvider, SearchResult } from './types.ts';

const result = (url: string, provider: string, text?: string): SearchResult => ({
  title: url,
  url,
  snippet: 'snippet',
  text,
  provider,
});

function fakeProvider(name: string, behaviour: () => SearchResult[]): SearchProvider & { calls: number } {
  const p = {
    name,
    calls: 0,
    async search() {
      p.calls++;
      return behaviour();
    },
  };
  return p;
}

const noFetch = async () => null;

describe('web search', () => {
  it('falls back to the next provider when the first one fails', async () => {
    const exa = fakeProvider('exa', () => {
      throw new Error('rate limited');
    });
    const brave = fakeProvider('brave', () => [result('https://neon.com/pricing', 'brave', 'Free: 0.5 GB')]);
    const web = createWebSearch({ providers: [exa, brave], memory: openMemory(':memory:'), fetchPage: noFetch });

    const results = await web.search({ query: 'neon pricing' });

    expect(results.map((r) => r.provider)).toEqual(['brave']);
  });

  it('serves a repeated query from cache without calling the provider again', async () => {
    const exa = fakeProvider('exa', () => [result('https://neon.com/pricing', 'exa', 'Free: 0.5 GB')]);
    const web = createWebSearch({ providers: [exa], memory: openMemory(':memory:'), fetchPage: noFetch });

    await web.search({ query: 'Neon pricing' });
    const second = await web.search({ query: '  neon   PRICING ' });

    expect(exa.calls).toBe(1);
    expect(second[0]?.url).toBe('https://neon.com/pricing');
  });

  it('fetches page text for top results that came back with only a snippet', async () => {
    const brave = fakeProvider('brave', () => [result('https://a.com', 'brave'), result('https://b.com', 'brave')]);
    const web = createWebSearch({
      providers: [brave],
      memory: openMemory(':memory:'),
      fetchPage: async (url) => `full text of ${url}`,
    });

    const results = await web.search({ query: 'x' });

    expect(results.map((r) => r.text)).toEqual(['full text of https://a.com', 'full text of https://b.com']);
  });

  it('reports a clear error when every provider fails', async () => {
    const exa = fakeProvider('exa', () => {
      throw new Error('down');
    });
    const web = createWebSearch({ providers: [exa], memory: openMemory(':memory:'), fetchPage: noFetch });

    await expect(web.search({ query: 'x' })).rejects.toThrow(/All search providers failed/);
  });
});
