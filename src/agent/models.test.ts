import { describe, expect, it } from 'vitest';
import { budgetFor, modelConfig } from './models.ts';

describe('modelConfig', () => {
  it('uses Groq when asked, with separate fast and answer models (separate free quotas)', () => {
    expect(modelConfig({ GROQ_API_KEY: 'k', MODEL_PROVIDER: 'groq' })).toEqual({
      provider: 'groq',
      fast: 'openai/gpt-oss-20b',
      answer: 'openai/gpt-oss-120b',
    });
    expect(budgetFor('groq').excerptChars).toBeLessThan(budgetFor('anthropic').excerptChars);
  });

  it('uses Gemini when only a Gemini key is set', () => {
    expect(modelConfig({ GEMINI_API_KEY: 'k' })).toMatchObject({ provider: 'google', answer: 'gemini-3.5-flash' });
  });

  it('prefers Anthropic when both keys are set, unless MODEL_PROVIDER says otherwise', () => {
    expect(modelConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }).provider).toBe('anthropic');
    expect(modelConfig({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', MODEL_PROVIDER: 'google' }).provider).toBe('google');
  });

  it('reports no provider when the chosen provider has no key', () => {
    expect(modelConfig({ MODEL_PROVIDER: 'google', ANTHROPIC_API_KEY: 'a' }).provider).toBeNull();
    expect(modelConfig({}).provider).toBeNull();
  });

  it('lets FAST_MODEL and ANSWER_MODEL override the defaults', () => {
    expect(modelConfig({ GEMINI_API_KEY: 'k', ANSWER_MODEL: 'gemini-pro-latest' }).answer).toBe('gemini-pro-latest');
  });
});
