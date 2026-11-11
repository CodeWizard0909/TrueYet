import type { Verdict } from './verdict.ts';
import type { Tier } from './router.ts';

/** One row of a recheck: what we said then, what the web says now. */
export interface RecheckRow {
  entity: string;
  attribute: string;
  then: string;
  thenAsOf: string;
  now: string | null;
  verdict: Verdict;
  sourceUrl: string | null;
  /** The [n] citation of the source that states the current value. */
  sourceN: number | null;
  note?: string;
}

export interface SourceRef {
  n: number;
  title: string;
  url: string;
  publishedAt?: string;
}

/** Everything the agent streams to the client while answering one turn. */
export type AgentEvent =
  | { type: 'step'; id: string; label: string; status: 'running' | 'done' | 'failed' }
  | { type: 'plan'; tier: Tier; topics: string[] }
  | {
      type: 'memory';
      turns: { at: string; role: string; text: string }[];
      claims: { entity: string; attribute: string; value: string; asOf: string; superseded: boolean }[];
      collections: { name: string; members: string[] }[];
      emptyDays: string[];
    }
  | { type: 'recheck'; rows: RecheckRow[] }
  | { type: 'source'; source: SourceRef }
  | { type: 'text'; delta: string }
  | { type: 'done'; tier: Tier; timings: Record<string, number>; turnId: number }
  | { type: 'error'; message: string };

export type Emit = (event: AgentEvent) => void;
