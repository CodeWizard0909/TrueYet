import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { LanguageModel } from 'ai';
import type { Claim } from '../memory/store.ts';
import type { WebSearch } from '../search/web.ts';
import type { Emit, RecheckRow } from './events.ts';
import type { SourceBook } from './sources.ts';
import { verdictFor } from './verdict.ts';
import { TIMEOUTS, withTimeout } from '../lib/timeout.ts';
import { ROOMY, type Budget } from './budget.ts';


const extraction = z.object({
  results: z.array(
    z.object({
      claim: z.number().int().describe('The claim number from the list.'),
      found: z.boolean().describe('True only if an excerpt explicitly states the current value.'),
      value: z.string().nullable().describe('The current value, written in the same format as the old value.'),
      sourceNumber: z.number().int().nullable().describe('The [n] of the excerpt that states it.'),
      note: z.string().nullable().describe('One short clause of context, e.g. "renamed to Launch plan".'),
    }),
  ),
});

/**
 * Checks remembered claims against the web today.
 * 1. One search per claim, in parallel (fast, cached).
 * 2. One extraction call for all claims together: a single model round trip
 *    instead of N, which matters on rate-limited tiers.
 * 3. Verdicts decided in code (verdictFor), so the model can't call a change "unchanged".
 */
export async function recheckClaims(args: {
  claims: Claim[];
  web: WebSearch;
  model: LanguageModel;
  sources: SourceBook;
  emit: Emit;
  now: Date;
  budget?: Budget;
  signal?: AbortSignal;
}): Promise<RecheckRow[]> {
  const budget = args.budget ?? ROOMY;
  const targets = uniqueByFact(args.claims).slice(0, budget.recheckClaims);
  const year = args.now.getUTCFullYear();

  const searched = await Promise.all(
    targets.map(async (claim, i) => {
      const id = `recheck-${i}`;
      args.emit({ type: 'step', id, label: `Checking ${claim.entity} ${claim.attribute}`, status: 'running' });
      try {
        const results = await args.web.search({ query: `${claim.entity} ${claim.attribute} ${year}`, maxResults: budget.recheckResults }, args.signal);
        args.emit({ type: 'step', id, label: `Checked ${claim.entity} ${claim.attribute}`, status: 'done' });
        return args.sources.forModel(results, budget.recheckExcerptChars);
      } catch (err) {
        if (args.signal?.aborted) throw err;
        args.emit({ type: 'step', id, label: `Couldn't search ${claim.entity}`, status: 'failed' });
        return [];
      }
    }),
  );

  const rows: RecheckRow[] = targets.map((claim) => ({
    entity: claim.entity,
    attribute: claim.attribute,
    then: claim.value,
    thenAsOf: claim.asOf.toISOString(),
    now: null,
    verdict: 'unverified',
    sourceUrl: null,
    sourceN: null,
  }));
  if (searched.every((s) => s.length === 0)) return rows.map((r) => ({ ...r, note: 'search failed' }));

  args.emit({ type: 'step', id: 'recheck-compare', label: `Comparing ${targets.length} remembered values with today`, status: 'running' });
  try {
    const { output } = await generateText({
      model: args.model,
      system:
        'For each numbered claim, extract its current value from that claim\'s web excerpts. Use only what the excerpts say. ' +
        'If they do not explicitly state it, set found=false. Never repeat the old value unless an excerpt confirms it.',
      prompt:
        `Today: ${args.now.toISOString().slice(0, 10)}\n\n` +
        targets
          .map(
            (c, i) =>
              `## Claim ${i}: ${c.entity} · ${c.attribute}\nOld value (as of ${c.asOf.toISOString().slice(0, 10)}): ${c.value}\nExcerpts:\n` +
              (searched[i]!.map((e) => `[${e.n}] ${e.title} (published ${e.published})\n${e.excerpt}`).join('\n\n') || '(none)'),
          )
          .join('\n\n'),
      output: Output.object({ schema: extraction }),
      maxOutputTokens: 200 + 120 * targets.length,
      abortSignal: withTimeout(TIMEOUTS.extract, args.signal),
    });
    for (const r of output.results) {
      const row = rows[r.claim];
      if (!row) continue;
      const now = r.found ? r.value : null;
      const sourceUrl = r.sourceNumber ? (args.sources.url(r.sourceNumber) ?? null) : null;
      Object.assign(row, {
        now,
        verdict: verdictFor(row.then, now),
        sourceUrl,
        sourceN: sourceUrl ? r.sourceNumber : null,
        note: r.note ?? undefined,
      });
    }
    args.emit({ type: 'step', id: 'recheck-compare', label: `Compared ${targets.length} values`, status: 'done' });
  } catch (err) {
    if (args.signal?.aborted) throw err;
    args.emit({ type: 'step', id: 'recheck-compare', label: "Couldn't compare values", status: 'failed' });
  }
  return rows;
}

/** One claim per entity+attribute; the first one wins (the recalled, older value). */
function uniqueByFact(claims: Claim[]): Claim[] {
  const seen = new Set<string>();
  return claims.filter((c) => {
    const key = `${c.entity.toLowerCase()}|${c.attribute}`;
    return !seen.has(key) && seen.add(key);
  });
}
