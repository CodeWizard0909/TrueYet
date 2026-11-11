import { describe, expect, it } from 'vitest';
import { findRecording, RECORDINGS, replay } from './demo.ts';
import type { AgentEvent } from '../../src/agent/events.ts';

async function collect(question: string) {
  const out: AgentEvent[] = [];
  for await (const e of replay(question, undefined, 0)) out.push(e);
  return out;
}

describe('demo replay', () => {
  it('ships recordings that finished cleanly, with real sources and the hand-offs the demo promises', () => {
    for (const r of RECORDINGS) {
      const events = r.events.map(([, e]) => e);
      expect(events.some((e) => e.type === 'error')).toBe(false);
      expect(events.at(-1)?.type).toBe('done');
      expect(events.some((e) => e.type === 'source')).toBe(true);
    }
    const crmSteps = findRecording(RECORDINGS[1]!.question)!.events.flatMap(([, e]) => (e.type === 'step' ? [e.id] : []));
    expect(crmSteps).toEqual(expect.arrayContaining(['plan', 'memory', 'recheck-0', 'search-1']));
  });

  it('replays a recorded question in order, matching loosely on spacing and case', async () => {
    const q = RECORDINGS[0]!.question;
    const events = await collect(`  ${q.toUpperCase()}  `);
    expect(events).toEqual(RECORDINGS[0]!.events.map(([, e]) => e));
  });

  it('never invents an answer for a question that was not recorded', async () => {
    expect(await collect('What is the weather in Delhi?')).toEqual([
      { type: 'error', message: expect.stringContaining('only replays the recorded examples') },
    ]);
  });
});
