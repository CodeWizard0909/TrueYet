import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import type { RecheckRow, SourceRef } from '../agent/events.ts';
import type { Memory, Turn } from './store.ts';
import { TIMEOUTS } from '../lib/timeout.ts';

// Limits are enforced in code, not in the schema: strict providers (Groq) reject the
// whole extraction over one extra item, and then nothing gets remembered at all.
const MAX_CLAIMS = 20;
const MAX_COLLECTIONS = 3;
const MAX_MEMBERS = 12;

const extraction = z.object({
  claims: z
    .array(
      z.object({
        entity: z.string().describe('Product, company or service name, e.g. "Neon".'),
        attribute: z.string().describe('Short, reusable attribute name, e.g. "free tier storage", "pro plan price".'),
        value: z.string().describe('The value exactly as stated, with units and period, e.g. "$19/month".'),
        sourceNumber: z.number().int().describe('The [n] citation that supports it.'),
      }),
    )
    .describe(`The most useful claims, at most ${MAX_CLAIMS}.`),
  collections: z
    .array(
      z.object({
        name: z.string().describe('How the user would refer to it later, e.g. "CRM shortlist".'),
        description: z.string().describe('One line of context, e.g. "CRM tools for a 20-person sales team".'),
        members: z.array(z.string()).describe('2 to 12 entity names.'),
      }),
    )
    .describe('At most 3.'),
});

const SYSTEM = `You maintain a memory of facts a research assistant told a user.
Extract claims: checkable facts that can change over time (prices, plan limits, features, versions, dates), each
supported by a cited source [n] in the answer. Skip opinions, advice, and anything without a citation.
Extract a collection only when the user or the answer frames a set of options being considered together
(a shortlist, candidates, "the options we compared"). Use the same entity names the answer uses.`;

/**
 * Runs after the answer has streamed, so it never adds latency. Only answers
 * backed by fresh sources produce claims: a recall answer restating old facts
 * must not create new claims with today's as-of date.
 */
export async function writeMemory(args: {
  memory: Memory;
  model: LanguageModel;
  userText: string;
  answer: Turn;
  sources: SourceRef[];
  recheck: RecheckRow[] | null;
}): Promise<{ claims: number; collections: number }> {
  const { memory, answer } = args;

  // Rechecked values were verified directly: store them without another model call.
  const rechecked = (args.recheck ?? [])
    .filter((r) => r.now && r.verdict !== 'unverified')
    .map((r) => ({ entity: r.entity, attribute: r.attribute, value: r.now!, asOf: answer.at, sourceUrl: r.sourceUrl }));
  if (rechecked.length) memory.addClaims(answer.id, rechecked);

  if (args.sources.length === 0) return { claims: rechecked.length, collections: 0 };

  const { output } = await generateText({
    model: args.model,
    system: SYSTEM,
    prompt:
      `User asked:\n${args.userText}\n\nAnswer:\n${answer.text}\n\nSources:\n` +
      args.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join('\n'),
    output: Output.object({ schema: extraction }),
    maxOutputTokens: 1500,
    abortSignal: AbortSignal.timeout(TIMEOUTS.memoryWrite),
  });

  const byNumber = new Map(args.sources.map((s) => [s.n, s]));
  const claims = output.claims
    .filter((c) => byNumber.has(c.sourceNumber))
    .slice(0, MAX_CLAIMS)
    .map((c) => {
      const source = byNumber.get(c.sourceNumber)!;
      return {
        entity: c.entity,
        attribute: c.attribute,
        value: c.value,
        asOf: answer.at,
        sourceUrl: source.url,
        sourcePublishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
      };
    })
    .map((c) => ({ ...c, sourcePublishedAt: c.sourcePublishedAt && !Number.isNaN(c.sourcePublishedAt.getTime()) ? c.sourcePublishedAt : null }));
  if (claims.length) memory.addClaims(answer.id, claims);

  const collections = output.collections
    .map((c) => ({ ...c, members: [...new Set(c.members.map((m) => m.trim()).filter(Boolean))].slice(0, MAX_MEMBERS) }))
    .filter((c) => c.members.length >= 2) // a "collection" of one thing is not a shortlist
    .slice(0, MAX_COLLECTIONS);
  for (const c of collections) {
    memory.addCollection({ ...c, turnId: answer.id, createdAt: answer.at });
  }
  return { claims: rechecked.length + claims.length, collections: collections.length };
}
