import { beforeEach, describe, expect, it } from 'vitest';
import { openMemory, type Memory } from './store.ts';
import { recall } from './recall.ts';

const tz = 'Asia/Kolkata';
const now = new Date('2026-11-11T10:00:00+05:30'); // Wednesday
let memory: Memory;

function say(role: 'user' | 'assistant', text: string, at: string) {
  return memory.addTurn({ threadId: 't1', role, text, at: new Date(at), timeZone: tz });
}

beforeEach(() => {
  memory = openMemory(':memory:');
});

describe('recall by date', () => {
  it('returns both sides of the conversation from the recalled day', () => {
    say('user', 'Which Postgres hosts are cheapest?', '2026-11-03T09:00:00+05:30');
    say('assistant', 'Neon and Supabase have the cheapest entry tiers.', '2026-11-03T09:00:05+05:30');
    say('user', 'Thanks, what about Redis?', '2026-11-04T09:00:00+05:30');

    const pack = recall(memory, { text: 'What did I ask you on 3 November?', now, timeZone: tz });

    expect(pack.turns.map((t) => t.text)).toEqual([
      'Which Postgres hosts are cheapest?',
      'Neon and Supabase have the cheapest entry tiers.',
    ]);
    expect(pack.emptyWindows).toEqual([]);
  });

  it('reports a recalled day with nothing in it instead of inventing turns', () => {
    say('user', 'Which Postgres hosts are cheapest?', '2026-11-04T09:00:00+05:30');

    const pack = recall(memory, { text: 'What did I ask you on 3 November?', now, timeZone: tz });

    expect(pack.turns).toEqual([]);
    expect(pack.emptyWindows.map((w) => w.phrase)).toEqual([expect.stringContaining('3 November')]);
    expect(pack.nearestDays).toEqual(['2026-11-04']);
  });
});

describe('recall by topic', () => {
  it('finds the topic even when the date phrase points at a different day', () => {
    // "Last Tuesday" resolves to 10 Nov, but the user actually meant the Tuesday before.
    say('user', 'Where should I host Postgres for a side project?', '2026-11-03T09:00:00+05:30');
    say('assistant', 'Neon free tier: 0.5 GB. Supabase free tier: 500 MB.', '2026-11-03T09:00:05+05:30');
    say('user', 'Best pizza near Indiranagar?', '2026-11-10T20:00:00+05:30');

    const pack = recall(memory, {
      text: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
      topics: ['Postgres hosting'],
      now,
      timeZone: tz,
    });

    expect(pack.turns.map((t) => t.text)).toEqual([
      'Where should I host Postgres for a side project?',
      'Neon free tier: 0.5 GB. Supabase free tier: 500 MB.',
    ]);
  });
});

describe('recall of claims and collections', () => {
  it('returns the claims made in recalled turns, with entity names and as-of dates', () => {
    say('user', 'Where should I host Postgres?', '2026-11-03T09:00:00+05:30');
    const answer = say('assistant', 'Neon free tier: 0.5 GB storage.', '2026-11-03T09:00:05+05:30');
    memory.addClaims(answer.id, [
      { entity: 'Neon', attribute: 'free tier storage', value: '0.5 GB', asOf: answer.at, sourceUrl: 'https://neon.com/pricing' },
    ]);

    const pack = recall(memory, { text: 'What did I ask on 3 November?', now, timeZone: tz });

    expect(pack.claims).toMatchObject([
      { entity: 'Neon', attribute: 'free tier storage', value: '0.5 GB', sourceUrl: 'https://neon.com/pricing', superseded: false },
    ]);
    expect(pack.claims[0]!.asOf.toISOString()).toBe(answer.at.toISOString());
  });

  it('marks a claim superseded once a newer one about the same thing exists', () => {
    const first = say('assistant', 'Neon free tier: 0.5 GB.', '2026-11-03T09:00:05+05:30');
    memory.addClaims(first.id, [{ entity: 'Neon', attribute: 'free tier storage', value: '0.5 GB', asOf: first.at }]);
    const second = say('assistant', 'Neon free tier is now 1 GB.', '2026-11-10T09:00:05+05:30');
    memory.addClaims(second.id, [{ entity: 'neon', attribute: 'Free tier storage', value: '1 GB', asOf: second.at }]);

    const pack = recall(memory, { text: 'What did you tell me on 3 November?', now, timeZone: tz });

    expect(pack.claims).toMatchObject([{ value: '0.5 GB', superseded: true }]);
  });

  it('resolves a named collection to its members and their latest claims', () => {
    const answer = say('assistant', 'Shortlist: HubSpot, Pipedrive, Zoho.', '2026-11-09T11:00:00+05:30');
    memory.addClaims(answer.id, [{ entity: 'HubSpot', attribute: 'starter price', value: '$20/seat/month', asOf: answer.at }]);
    memory.addCollection({
      name: 'CRM shortlist',
      description: 'CRM tools for a 20-person sales team',
      members: ['HubSpot', 'Pipedrive', 'Zoho'],
      turnId: answer.id,
    });

    const pack = recall(memory, {
      text: 'On Monday we shortlisted 5 CRM tools. Has any of them changed pricing?',
      topics: ['CRM tools'],
      now,
      timeZone: tz,
    });

    expect(pack.collections).toMatchObject([{ name: 'CRM shortlist', members: ['HubSpot', 'Pipedrive', 'Zoho'] }]);
    expect(pack.claims).toMatchObject([{ entity: 'HubSpot', value: '$20/seat/month' }]);
  });
});

describe('recall precision for fresh lookups', () => {
  it('does not drag in old chats that only share generic words like "price" or "latest"', () => {
    say('user', 'Compare Postgres hosting prices', '2026-11-03T09:00:00+05:30');
    say('assistant', 'Neon is $19/month, the latest pricing.', '2026-11-03T09:00:05+05:30');

    const pack = recall(memory, {
      text: 'What is the latest iPhone and its price in India?',
      topics: ['latest iPhone', 'iPhone price India'],
      strictTopics: true,
      now,
      timeZone: tz,
    });

    expect(pack.turns).toEqual([]);
  });

  it('still finds a past chat that matches every meaningful word of the topic', () => {
    say('user', 'Which Postgres host is cheapest?', '2026-11-03T09:00:00+05:30');
    say('assistant', 'Neon has the cheapest Postgres entry plan.', '2026-11-03T09:00:05+05:30');

    const pack = recall(memory, { text: 'Postgres hosting again?', topics: ['Postgres host'], strictTopics: true, now, timeZone: tz });

    expect(pack.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
  });
});

describe('deleting a thread', () => {
  it('removes its turns, claims and collections, and keeps other threads', () => {
    const a = memory.addTurn({ threadId: 'seed', role: 'assistant', text: 'Shortlist: HubSpot, Pipedrive.', at: new Date('2026-11-09T11:00:00+05:30'), timeZone: tz });
    memory.addClaims(a.id, [{ entity: 'HubSpot', attribute: 'starter price', value: '$20', asOf: a.at }]);
    memory.addCollection({ name: 'CRM shortlist', members: ['HubSpot', 'Pipedrive'], turnId: a.id });
    say('user', 'Keep me: Postgres question', '2026-11-03T09:00:00+05:30');

    memory.deleteThread('seed');

    expect(memory.searchTurns('HubSpot')).toEqual([]);
    expect(memory.latestClaimsFor(['HubSpot'])).toEqual([]);
    expect(memory.findCollections({ topics: ['CRM'] })).toEqual([]);
    expect(memory.searchTurns('Postgres').map((t) => t.text)).toEqual(['Keep me: Postgres question']);
  });
});
