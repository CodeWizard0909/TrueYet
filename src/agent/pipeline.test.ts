import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../lib/clock.ts';
import { openMemory, type Memory } from '../memory/store.ts';
import { createWebSearch } from '../search/web.ts';
import type { SearchProvider } from '../search/types.ts';
import type { AgentEvent } from './events.ts';
import { runTurn } from './pipeline.ts';
import { fakeModels } from './testModels.ts';

const tz = 'Asia/Kolkata';
let memory: Memory;

const neonToday: SearchProvider = {
  name: 'fake',
  async search() {
    return [
      { title: 'Neon pricing', url: 'https://neon.com/pricing', snippet: '', text: 'Free plan: 1 GB storage.', provider: 'fake' },
    ];
  },
};

beforeEach(() => {
  memory = openMemory(':memory:');
});

async function ask(text: string, at: string, models: ReturnType<typeof fakeModels>) {
  const events: AgentEvent[] = [];
  const web = createWebSearch({ providers: [neonToday], memory, fetchPage: async () => null });
  const { memoryWrite } = await runTurn(
    { memory, web, models },
    { threadId: 't1', text, timeZone: tz, clock: fixedClock(at) },
    (e) => events.push(e),
  );
  await memoryWrite;
  return events;
}

describe('runTurn', () => {
  it('rechecks a remembered price and reports it as changed, with both dates in context', async () => {
    const q = memory.addTurn({ threadId: 't1', role: 'user', text: 'Where should I host Postgres?', at: new Date('2026-11-03T09:00:00+05:30'), timeZone: tz });
    const a = memory.addTurn({ threadId: 't1', role: 'assistant', text: 'Neon free tier: 0.5 GB [1].', at: new Date('2026-11-03T09:00:05+05:30'), timeZone: tz });
    memory.addClaims(a.id, [{ entity: 'Neon', attribute: 'free tier storage', value: '0.5 GB', asOf: a.at, sourceUrl: 'https://neon.com/pricing' }]);
    void q;

    const models = fakeModels({
      plan: { tier: 'recheck', topics: ['Postgres hosting'], searchQueries: [] },
      extract: () => ({ results: [{ claim: 0, found: true, value: '1 GB', sourceNumber: 1, note: null }] }),
      answer: 'Yes: Neon free storage went from 0.5 GB to 1 GB [1].',
    });

    const events = await ask(
      'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
      '2026-11-11T10:00:00+05:30',
      models,
    );

    const recheck = events.find((e) => e.type === 'recheck');
    expect(recheck).toMatchObject({ rows: [{ entity: 'Neon', then: '0.5 GB', now: '1 GB', verdict: 'changed', sourceUrl: 'https://neon.com/pricing' }] });
    expect(models.prompts.answer[0]).toContain('then \\"0.5 GB\\"');
    expect(models.prompts.answer[0]).toContain('→ changed [1]'); // the row carries its citation
    expect(events.at(-1)).toMatchObject({ type: 'done', tier: 'recheck' });
  });

  it('stores the new value as the current claim and keeps the old one as superseded', async () => {
    const a = memory.addTurn({ threadId: 't1', role: 'assistant', text: 'Neon free tier: 0.5 GB.', at: new Date('2026-11-03T09:00:05+05:30'), timeZone: tz });
    memory.addClaims(a.id, [{ entity: 'Neon', attribute: 'free tier storage', value: '0.5 GB', asOf: a.at }]);

    await ask('What did you tell me on 3 November about Neon? Is it still correct?', '2026-11-11T10:00:00+05:30', fakeModels({
      plan: { tier: 'recall', topics: ['Neon'], searchQueries: [] },
      extract: () => ({ results: [{ claim: 0, found: true, value: '1 GB', sourceNumber: 1, note: null }] }),
      answer: 'It changed to 1 GB [1].',
    }));

    expect(memory.latestClaimsFor(['Neon']).map((c) => c.value)).toEqual(['1 GB']);
    expect(memory.claimsForTurns([a.id])).toMatchObject([{ value: '0.5 GB', superseded: true }]);
  });

  it('answers a recall about an empty day without searching, and saves both turns', async () => {
    memory.addTurn({ threadId: 't1', role: 'user', text: 'Best CRM?', at: new Date('2026-11-04T09:00:00+05:30'), timeZone: tz });

    const models = fakeModels({
      plan: { tier: 'recall', topics: [], searchQueries: [] },
      answer: "I don't have a conversation from 3 Nov; the nearest is 4 Nov.",
    });
    const events = await ask('What did I ask you on 3 November?', '2026-11-11T10:00:00+05:30', models);

    expect(events.some((e) => e.type === 'step' && e.label.startsWith('Search'))).toBe(false);
    expect(models.prompts.answer[0]).toContain('no conversation that day');
    expect(models.prompts.answer[0]).toContain('2026-11-04');
    expect(memory.recentTurns('t1').map((t) => t.role)).toEqual(['user', 'user', 'assistant']);
  });

  it('announces the early web search as a step, after planning starts, so the UI can hand off to the search dog', async () => {
    const events = await ask('What is the latest LTS version of Node.js?', '2026-11-11T10:00:00+05:30', fakeModels({
      plan: { tier: 'lookup', topics: ['Node.js LTS'], searchQueries: [] },
      answer: 'Node 26 is the LTS [1].',
    }));

    const steps = events.flatMap((e) => (e.type === 'step' ? [`${e.id}:${e.status}`] : []));
    expect(steps.indexOf('plan:running')).toBeLessThan(steps.indexOf('search-early:running'));
    expect(steps).toContain('search-early:done');
  });

  it('saves claims and a collection from a cited research answer', async () => {
    await ask('Shortlist 3 CRMs for a 20-person sales team?', '2026-11-09T11:00:00+05:30', fakeModels({
      plan: { tier: 'research', topics: ['CRM'], searchQueries: [] },
      memory: {
        claims: [{ entity: 'HubSpot', attribute: 'starter price', value: '$20/seat/month', sourceNumber: 1 }],
        collections: [{ name: 'CRM shortlist', description: 'CRMs for a 20-person sales team', members: ['HubSpot', 'Pipedrive', 'Zoho'] }],
      },
      answer: 'HubSpot ($20/seat/month [1]), Pipedrive, Zoho.',
    }));

    expect(memory.latestClaimsFor(['hubspot'])).toMatchObject([{ value: '$20/seat/month', sourceUrl: 'https://neon.com/pricing' }]);
    expect(memory.findCollections({ topics: ['CRM'] })).toMatchObject([{ members: ['HubSpot', 'Pipedrive', 'Zoho'] }]);
  });
});
