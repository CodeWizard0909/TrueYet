import { describe, expect, it } from 'vitest';
import { fakeModels } from '../agent/testModels.ts';
import { openMemory } from './store.ts';
import { writeMemory } from './writer.ts';

describe('writeMemory', () => {
  it('keeps the first 20 claims when the model returns more, instead of saving nothing', async () => {
    const memory = openMemory(':memory:');
    const answer = memory.addTurn({ threadId: 't', role: 'assistant', text: 'A long answer [1].', at: new Date('2026-11-11T10:00:00Z'), timeZone: 'UTC' });
    const claims = Array.from({ length: 27 }, (_, i) => ({ entity: `Product ${i}`, attribute: 'price', value: `$${i}`, sourceNumber: 1 }));
    const models = fakeModels({
      plan: {},
      answer: '',
      memory: {
        claims,
        collections: [
          { name: 'Phone shortlist', description: 'phones under 50k', members: ['Pixel 11', 'Galaxy S27', 'Pixel 11'] },
          { name: 'Lonely', description: 'not a shortlist', members: ['Only one'] },
        ],
      },
    });

    const result = await writeMemory({
      memory,
      model: models.fast,
      userText: 'Compare phones',
      answer,
      sources: [{ n: 1, title: 'Source', url: 'https://example.com' }],
      recheck: null,
    });

    expect(result).toEqual({ claims: 20, collections: 1 });
    expect(memory.claimsForTurns([answer.id])).toHaveLength(20);
    expect(memory.findCollections({ topics: ['phone'] })).toMatchObject([{ name: 'Phone shortlist', members: ['Pixel 11', 'Galaxy S27'] }]);
  });
});
