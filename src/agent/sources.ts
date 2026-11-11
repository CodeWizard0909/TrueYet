import type { SearchResult } from '../search/types.ts';
import type { Emit, SourceRef } from './events.ts';

/**
 * Numbers every source seen during a turn, so the model can cite [n] and the
 * UI can link it. The same URL always keeps the same number.
 */
export class SourceBook {
  private byUrl = new Map<string, SourceRef>();

  constructor(private emit: Emit) {}

  add(result: SearchResult): SourceRef {
    const existing = this.byUrl.get(result.url);
    if (existing) return existing;
    const ref: SourceRef = {
      n: this.byUrl.size + 1,
      title: result.title,
      url: result.url,
      publishedAt: result.publishedAt,
    };
    this.byUrl.set(result.url, ref);
    this.emit({ type: 'source', source: ref });
    return ref;
  }

  /** Search results as the model sees them: numbered, dated, with a bounded excerpt. */
  forModel(results: SearchResult[], excerptChars = 1800) {
    return results.map((r) => {
      const ref = this.add(r);
      return {
        n: ref.n,
        title: r.title,
        url: r.url,
        published: r.publishedAt?.slice(0, 10) ?? 'unknown',
        excerpt: (r.text ?? r.snippet).slice(0, excerptChars),
      };
    });
  }

  list(): SourceRef[] {
    return [...this.byUrl.values()];
  }

  url(n: number): string | undefined {
    return this.list().find((s) => s.n === n)?.url;
  }
}
