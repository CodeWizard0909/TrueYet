import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { Turn } from '../memory/store.ts';
import { fallbackPlan, TIERS, type Plan } from './router.ts';
import { TIMEOUTS, withTimeout } from '../lib/timeout.ts';

const planSchema = z.object({
  tier: z
    .enum(TIERS)
    .describe(
      'chat: no facts needed. recall: only about our past conversation. lookup: one fact from the web. ' +
        'research: compare or survey several things. recheck: is something we discussed before still true / what changed since.',
    ),
  topics: z
    .array(z.string())
    .describe('Short subject phrases for searching past conversation, e.g. "Postgres hosting", "CRM tools".'),
  searchQueries: z
    .array(z.string())
    .describe('Web searches to run now. Empty for chat and recall. Include the year when freshness matters.'),
});

const SYSTEM = `You route messages for a chat agent that has web search and a memory of past conversations.
Decide the tier, the topics to look up in memory, and the first web searches. Be fast and literal.
Resolve pronouns using the recent conversation so searches are self-contained.`;

/** One fast structured call. Falls back to rules if the model call fails, so a turn never dies here. */
export async function planTurn(args: {
  model: LanguageModel;
  text: string;
  history: Turn[];
  now: Date;
  hasRecallWindow: boolean;
  signal?: AbortSignal;
}): Promise<Plan> {
  const recent = args.history
    .slice(-6)
    .map((t) => `${t.role}: ${t.text.slice(0, 300)}`)
    .join('\n');
  try {
    const { output } = await generateText({
      model: args.model,
      system: SYSTEM,
      prompt: `Today is ${args.now.toISOString().slice(0, 10)}.\n\nRecent conversation:\n${recent || '(none)'}\n\nNew message:\n${args.text}`,
      output: Output.object({ schema: planSchema }),
      maxOutputTokens: 300,
      abortSignal: withTimeout(TIMEOUTS.plan, args.signal),
      maxRetries: 1,
    });
    // Limits are applied here, not in the schema: strict providers (Groq) reject the whole plan over one extra item.
    return { ...output, topics: output.topics.slice(0, 4), searchQueries: output.searchQueries.slice(0, 4) };
  } catch (err) {
    if (args.signal?.aborted) throw err;
    console.warn('[planner] falling back to rules:', (err as Error).message);
    return fallbackPlan(args.text, args.hasRecallWindow);
  }
}
