import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { defaultSettingsMiddleware, wrapLanguageModel, type LanguageModel } from 'ai';
import { ROOMY, TIGHT, type Budget } from './budget.ts';

/** Two models: a fast one for planning and extraction, a strong one for answers. */
export interface Models {
  fast: LanguageModel;
  answer: LanguageModel;
}

export const PROVIDERS = ['anthropic', 'google', 'groq'] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ModelConfig {
  provider: Provider | null;
  fast: string;
  answer: string;
}

const DEFAULTS: Record<Provider, { fast: string; answer: string }> = {
  anthropic: { fast: 'claude-haiku-5-5', answer: 'claude-sonnet-5-5' },
  // Pinned: gemini-flash-latest (3.8 Flash) hung for 40s+ on simple prompts in testing (Nov 2026).
  google: { fast: 'gemini-flash-lite-latest', answer: 'gemini-3.5-flash' },
  // Separate models = separate free-tier quotas (each 1K requests and 200K tokens a day).
  groq: { fast: 'openai/gpt-oss-20b', answer: 'openai/gpt-oss-120b' },
};

const googleKey = (env: NodeJS.ProcessEnv) => env.GOOGLE_GENERATIVE_AI_API_KEY || env.GEMINI_API_KEY;

const KEY_FOR: Record<Provider, (env: NodeJS.ProcessEnv) => string | undefined> = {
  anthropic: (env) => env.ANTHROPIC_API_KEY,
  google: googleKey,
  groq: (env) => env.GROQ_API_KEY,
};

/**
 * Picks the provider: MODEL_PROVIDER if set, otherwise whichever key is
 * present (Anthropic, then Gemini, then Groq). Returns provider null when the
 * chosen provider has no key.
 */
export function modelConfig(env = process.env): ModelConfig {
  const requested = env.MODEL_PROVIDER?.toLowerCase();
  const provider: Provider | undefined = (PROVIDERS as readonly string[]).includes(requested ?? '')
    ? (requested as Provider)
    : PROVIDERS.find((p) => KEY_FOR[p](env));
  if (!provider || !KEY_FOR[provider](env)) return { provider: null, fast: '', answer: '' };
  return {
    provider,
    fast: env.FAST_MODEL ?? DEFAULTS[provider].fast,
    answer: env.ANSWER_MODEL ?? DEFAULTS[provider].answer,
  };
}

/** How much context each call may carry. Groq's free plan caps tokens per minute at 8K. */
export function budgetFor(provider: Provider | null): Budget {
  return provider === 'groq' ? TIGHT : ROOMY;
}

export function modelsFromEnv(env = process.env): Models {
  const config = modelConfig(env);
  if (config.provider === 'google') {
    const google = createGoogleGenerativeAI({ apiKey: googleKey(env) });
    // Gemini 3.x thinks before answering by default; that added 10s+ per answer in testing.
    // Minimal thinking for routing/extraction, low for answers.
    const thinking = (model: LanguageModel, thinkingLevel: 'minimal' | 'low') =>
      wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
        middleware: defaultSettingsMiddleware({ settings: { providerOptions: { google: { thinkingConfig: { thinkingLevel } } } } }),
      });
    return { fast: thinking(google(config.fast), 'minimal'), answer: thinking(google(config.answer), 'low') };
  }
  if (config.provider === 'groq') {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    // gpt-oss reasons before answering; low effort keeps latency and token use down.
    const lowEffort = (model: LanguageModel) =>
      wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
        middleware: defaultSettingsMiddleware({ settings: { providerOptions: { groq: { reasoningEffort: 'low' } } } }),
      });
    return { fast: lowEffort(groq(config.fast)), answer: lowEffort(groq(config.answer)) };
  }
  const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return { fast: anthropic(config.fast || DEFAULTS.anthropic.fast), answer: anthropic(config.answer || DEFAULTS.anthropic.answer) };
}

export const MISSING_KEY_MESSAGE =
  'No model API key is set. Add ANTHROPIC_API_KEY, GEMINI_API_KEY or GROQ_API_KEY to .env (copy .env.example) and restart.';
