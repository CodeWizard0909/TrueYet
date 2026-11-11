import { describe, expect, it } from 'vitest';
import { decideTier, fallbackPlan, quickPlan } from './router.ts';

const plan = (tier: 'chat' | 'recall' | 'lookup' | 'research' | 'recheck') => ({
  tier,
  topics: [],
  searchQueries: [],
});

describe('decideTier', () => {
  it('upgrades recall to recheck when the user asks whether an old answer still holds', () => {
    const text = 'What did I ask you on 3 November? Is your answer still correct today?';
    expect(decideTier(plan('recall'), { text, hasRecallWindow: true })).toBe('recheck');
  });

  it('upgrades to recheck when the user asks what changed since a recalled day', () => {
    const text = 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?';
    expect(decideTier(plan('lookup'), { text, hasRecallWindow: true })).toBe('recheck');
  });

  it('keeps a plain recall as recall', () => {
    expect(decideTier(plan('recall'), { text: 'What did I ask you on 3 November?', hasRecallWindow: true })).toBe(
      'recall',
    );
  });

  it('does not treat "changed" as a recheck without any reference to the past conversation', () => {
    expect(decideTier(plan('lookup'), { text: 'Has Stripe changed its fees?', hasRecallWindow: false })).toBe('lookup');
  });
});

describe('fallbackPlan (used when the planner model is unavailable)', () => {
  it('searches for questions and recalls for memory phrasing', () => {
    expect(fallbackPlan('What is the price of Neon?', false).tier).toBe('lookup');
    expect(fallbackPlan('What did I ask you on 3 November?', true).tier).toBe('recall');
    expect(fallbackPlan('thanks!', false).tier).toBe('chat');
  });
});

describe('quickPlan (skips the planner model when the answer is obvious)', () => {
  it('handles small talk and plain date recall without a model call', () => {
    expect(quickPlan('thanks, that was helpful!', false)?.tier).toBe('chat');
    expect(quickPlan('What did I ask you on 3 November?', true)?.tier).toBe('recall');
  });

  it('defers to the planner for anything that needs judgement', () => {
    expect(quickPlan('What did I ask you on 3 November? Is it still correct?', true)).toBeNull();
    expect(quickPlan('What is the price of Neon?', false)).toBeNull();
    expect(quickPlan('thanks! now compare Neon and Supabase', false)).toBeNull();
  });
});
