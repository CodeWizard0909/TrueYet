import type { AgentEvent } from '../../src/agent/events.ts';
import crmRecheck from './demo/crm-recheck.json';
import typescriptLatest from './demo/typescript-latest.json';

/**
 * Demo replay (open the app with ?demo=1): plays back real answers recorded with
 * `npm run record-demo` through the normal UI, with no API calls. It never invents
 * an answer: a question that was not recorded gets a clear "demo only" message.
 */
export interface Recording {
  id: string;
  question: string;
  recordedAt: string;
  provider: string;
  models: { fast: string; answer: string };
  events: [number, AgentEvent][];
}

export const RECORDINGS = [typescriptLatest, crmRecheck] as unknown as Recording[];

/** Long waits in a recording (free-tier rate limits) are shortened to this. */
export const MAX_GAP_MS = 1500;

export function isDemo(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

export function findRecording(question: string): Recording | undefined {
  return RECORDINGS.find((r) => same(r.question, question));
}

export async function* replay(question: string, signal?: AbortSignal, maxGapMs = MAX_GAP_MS): AsyncGenerator<AgentEvent> {
  const rec = findRecording(question);
  if (!rec) {
    yield {
      type: 'error',
      message: 'Demo mode only replays the recorded examples. Click one above, or open the app without ?demo=1 to ask anything.',
    };
    return;
  }
  let previous = 0;
  for (const [t, event] of rec.events) {
    const gap = Math.min(t - previous, maxGapMs);
    previous = t;
    if (gap > 0) await sleep(gap, signal);
    if (signal?.aborted) return;
    yield event;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
