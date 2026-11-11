export interface SearchQuery {
  query: string;
  /** Only results published on or after this moment. */
  since?: Date;
  maxResults?: number;
  /** Restrict to these domains, e.g. a vendor's own site for pricing. */
  domains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  /** Readable page text, when the provider returns it or we fetched it. */
  text?: string;
  publishedAt?: string;
  provider: string;
}

/** A web search backend. Swappable: the agent only depends on this. */
export interface SearchProvider {
  name: string;
  search(q: SearchQuery, signal?: AbortSignal): Promise<SearchResult[]>;
}
