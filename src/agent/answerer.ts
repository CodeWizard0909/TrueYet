import { isStepCount, streamText, tool } from 'ai';
import type { LanguageModel, ModelMessage } from 'ai';
import { z } from 'zod';
import type { Turn } from '../memory/store.ts';
import type { WebSearch } from '../search/web.ts';
import type { Emit } from './events.ts';
import { ANSWER_INSTRUCTIONS, inert } from './prompts.ts';
import type { SourceBook } from './sources.ts';
import type { Budget } from './budget.ts';
import { TIMEOUTS, withTimeout } from '../lib/timeout.ts';
import { CitationNormalizer } from './citations.ts';


/** The answer model with its single tool, streaming text to the client as it arrives. */
export async function streamAnswer(args: {
  model: LanguageModel;
  web: WebSearch | null;
  sources: SourceBook;
  context: string;
  history: Turn[];
  text: string;
  allowSearch: boolean;
  budget: Budget;
  emit: Emit;
  signal?: AbortSignal;
}): Promise<string> {
  let searchCount = 0;
  // Past the allowance the tool declines instead of disappearing:
  // removing tools on the last step makes some providers (Groq) reject the call.
  const maxSearches = args.budget.maxSearches;
  // Everything the searches returned, kept in case the model runs out of steps before answering.
  const gathered: string[] = [];

  const webSearch = tool({
    description:
      'Search the web. Returns numbered results with excerpts; cite them as [n]. ' +
      'Use `since` (YYYY-MM-DD) for "what changed since", and `domains` to read a vendor\'s own site. ' +
      `You have ${maxSearches} searches in total: combine related items into one query ` +
      '(e.g. "HubSpot Pipedrive Zoho pricing changes November 2026") rather than one search per item.',
    inputSchema: z.object({
      query: z.string().describe('A specific, self-contained search query. Include the year for anything time-sensitive.'),
      since: z.string().optional().describe('Only results published on or after this date, YYYY-MM-DD.'),
      domains: z.array(z.string()).optional().describe('Restrict to these domains, e.g. ["neon.com"].'),
    }),
    execute: async ({ query, since, domains }) => {
      if (searchCount >= maxSearches) {
        return { error: 'Search budget used up. Answer now with the results you already have.' };
      }
      const id = `search-${++searchCount}`;
      args.emit({ type: 'step', id, label: `Searching: ${query}`, status: 'running' });
      try {
        const sinceDate = since ? new Date(since) : undefined;
        const results = await args.web!.search(
          { query, since: sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined, domains, maxResults: args.budget.resultsPerSearch },
          args.signal,
        );
        args.emit({ type: 'step', id, label: `Searched: ${query}`, status: 'done' });
        const forModel = args.sources.forModel(results, args.budget.excerptChars);
        gathered.push(...forModel.map((r) => `[${r.n}] ${r.title} (${r.url}, published ${r.published})\n${r.excerpt}`));
        return forModel;
      } catch (err) {
        args.emit({ type: 'step', id, label: `Search failed: ${query}`, status: 'failed' });
        return { error: (err as Error).message };
      }
    },
  });

  // Retrieved context (memory, recheck rows, web excerpts) travels in the user turn, never as a
  // system message: it holds text from the web, which must not carry system authority.
  const userContent = `${args.context}\n\nThe user's message:\n${args.text}`;
  const messages: ModelMessage[] = [
    ...args.history.map((t) => ({ role: t.role, content: t.text }) as ModelMessage),
    { role: 'user', content: userContent },
  ];

  const system = [
    // Only the stable instructions, so the provider can cache them across turns.
    {
      role: 'system' as const,
      content: ANSWER_INSTRUCTIONS,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
  ];
  const signal = withTimeout(TIMEOUTS.answer, args.signal);

  const result = streamText({
    model: args.model,
    system,
    messages,
    tools: args.allowSearch && args.web ? { web_search: webSearch } : {},
    // Every allowed search, one step to hear "budget used up", and one to answer.
    stopWhen: isStepCount(maxSearches + 2),
    maxOutputTokens: 1800,
    abortSignal: signal,
    // Errors arrive as 'error' stream parts and are rethrown below; skip the SDK's raw console dump.
    onError: () => {},
  });

  let text = '';
  const emitText = (delta: string) => {
    if (!delta) return;
    text += delta;
    args.emit({ type: 'text', delta });
  };
  try {
    await pump(result.stream, emitText);
  } catch (err) {
    // gpt-oss was trained with built-in browser tools and sometimes calls one ("open") after
    // searching; the provider rejects the whole step. Recover below from what was gathered.
    if (!isUnknownToolError(err)) throw err;
  }

  // Some models (gpt-oss) search one item per step and can use up every step without
  // writing a word. Never return an empty answer: write one from what was gathered, with no tools.
  if (!text.trim()) {
    const finalAnswer = () =>
      streamText({
        model: args.model,
        system,
        messages: [
          ...messages.slice(0, -1),
          {
            role: 'user',
            content:
              `${userContent}\n\nWeb results already gathered for this question:\n<search_results>\n` +
              (gathered.map(inert).join('\n\n') || '(none)') +
              '\n</search_results>\n\nWrite the final answer now from the memory, recheck rows and these results. Do not search again; no tools are available.',
          },
        ],
        maxOutputTokens: 1800,
        abortSignal: signal,
        onError: () => {},
      });
    try {
      await pump(finalAnswer().stream, emitText);
    } catch (err) {
      // Even with no tools offered, gpt-oss occasionally reaches for "open"; one more try usually lands.
      if (!isUnknownToolError(err) || text.trim()) throw err;
      await pump(finalAnswer().stream, emitText);
    }
  }
  return text;
}

/** The model called a tool we never offered (e.g. gpt-oss's built-in "open"). */
export function isUnknownToolError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not in request\.tools|tool call validation failed|unknown tool|no such tool/i.test(message);
}

/** Streams text parts through the citation normaliser; rethrows stream errors. */
async function pump(
  stream: AsyncIterable<{ type: string; text?: string; error?: unknown }>,
  emitText: (delta: string) => void,
): Promise<void> {
  const citations = new CitationNormalizer();
  for await (const part of stream) {
    if (part.type === 'text-delta') emitText(citations.push(part.text ?? ''));
    else if (part.type === 'error') throw part.error instanceof Error ? part.error : new Error(String(part.error));
  }
  emitText(citations.flush());
}
