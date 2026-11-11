import { describe, expect, it } from 'vitest';
import { fakeModels } from '../agent/testModels.ts';
import { openMemory } from '../memory/store.ts';
import { createApp } from './app.ts';

function events(body: string) {
  return body
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => JSON.parse(l.slice(5)) as { type: string; [k: string]: unknown });
}

const post = (app: ReturnType<typeof createApp>, body: object, headers: Record<string, string> = {}) =>
  app.request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('POST /api/chat', () => {
  it('streams every event of a turn, ending with done', async () => {
    const memory = openMemory(':memory:');
    const models = fakeModels({ plan: { tier: 'chat', topics: [], searchQueries: [] }, answer: 'Hello!' });
    const app = createApp({ memory, web: null, models }, { hasModelKey: true, searchProviders: [] });

    const res = await post(app, { threadId: 't', text: 'hi', timeZone: 'Asia/Kolkata' });
    const received = events(await res.text());

    expect(received.filter((e) => e.type === 'text').map((e) => e.delta).join('')).toBe('Hello!');
    expect(received.at(-1)).toMatchObject({ type: 'done', tier: 'chat' });
  });

  it('stamps turns with the X-Now time so memory can be tested across days', async () => {
    const memory = openMemory(':memory:');
    const models = fakeModels({ plan: { tier: 'chat', topics: [], searchQueries: [] }, answer: 'ok' });
    const app = createApp({ memory, web: null, models }, { hasModelKey: true, searchProviders: [] });

    await (await post(app, { threadId: 't', text: 'hi', timeZone: 'UTC' }, { 'x-now': '2026-11-03T09:00:00Z' })).text();

    expect(memory.recentTurns('t')[0]?.at.toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });

  it('explains a missing API key instead of failing silently', async () => {
    const app = createApp(
      { memory: openMemory(':memory:'), web: null, models: fakeModels({ plan: {}, answer: '' }) },
      { hasModelKey: false, searchProviders: [] },
    );

    const received = events(await (await post(app, { threadId: 't', text: 'hi' })).text());

    expect(received).toEqual([{ type: 'error', message: expect.stringContaining('API key') }]);
  });
});
