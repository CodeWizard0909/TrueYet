import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Models } from './models.ts';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};

/**
 * Deterministic stand-ins for the two models. `fast` answers structured calls
 * by looking at what the prompt asks for; `answer` streams a fixed reply.
 */
export function fakeModels(opts: {
  plan: object;
  extract?: (prompt: string) => object;
  memory?: object;
  answer: string;
}): Models & { prompts: { fast: string[]; answer: string[] } } {
  const prompts = { fast: [] as string[], answer: [] as string[] };

  const fast = new MockLanguageModelV4({
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt);
      prompts.fast.push(prompt);
      const body = prompt.includes('You route messages')
        ? opts.plan
        : prompt.includes('For each numbered claim')
          ? (opts.extract?.(prompt) ?? { results: [] })
          : (opts.memory ?? { claims: [], collections: [] });
      return {
        content: [{ type: 'text', text: JSON.stringify(body) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });

  const answer = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.answer.push(JSON.stringify(options.prompt));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: opts.answer },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      };
    },
  });

  return { fast, answer, prompts };
}
