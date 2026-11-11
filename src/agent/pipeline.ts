import type { Clock } from '../lib/clock.ts';
import { recall, type MemoryPack } from '../memory/recall.ts';
import type { Memory } from '../memory/store.ts';
import { resolveRecallWindows } from '../memory/time.ts';
import { writeMemory } from '../memory/writer.ts';
import type { WebSearch } from '../search/web.ts';
import { streamAnswer } from './answerer.ts';
import type { Emit, RecheckRow } from './events.ts';
import type { Models } from './models.ts';
import { ROOMY, type Budget } from './budget.ts';
import { planTurn } from './planner.ts';
import { contextBlock } from './prompts.ts';
import { recheckClaims } from './recheck.ts';
import { decideTier, quickPlan, type Plan } from './router.ts';
import { SourceBook } from './sources.ts';

export interface AgentDeps {
  memory: Memory;
  web: WebSearch | null;
  models: Models;
  /** Context limits per call; defaults to ROOMY. Free tiers need TIGHT. */
  budget?: Budget;
}

export interface TurnInput {
  threadId: string;
  text: string;
  timeZone: string;
  clock: Clock;
  signal?: AbortSignal;
}

const SEARCH_TIERS = new Set(['lookup', 'research', 'recheck']);

/**
 * One user turn, end to end:
 *   resolve dates → plan ‖ recall ‖ early search → tier → recheck? → stream answer → save → write memory (async)
 * Returns a promise for the background memory write so tests and evals can wait for it.
 */
export async function runTurn(deps: AgentDeps, input: TurnInput, emit: Emit): Promise<{ memoryWrite: Promise<unknown> }> {
  const { memory, web, models } = deps;
  const now = input.clock.now();
  const timings: Record<string, number> = {};
  const t0 = performance.now();
  const mark = (name: string) => (timings[name] = Math.round(performance.now() - t0));
  const sources = new SourceBook(emit);

  const budget = deps.budget ?? ROOMY;
  const history = memory
    .recentTurns(input.threadId, budget.historyTurns)
    .map((t) => (t.text.length > budget.historyChars ? { ...t, text: t.text.slice(0, budget.historyChars) + ' …' } : t));
  const windows = resolveRecallWindows(input.text, now, input.timeZone);
  const hasRecallWindow = windows.length > 0;

  // Planning, recall and a speculative search run at the same time.
  emit({ type: 'step', id: 'plan', label: 'Understanding the question', status: 'running' });
  const quick = quickPlan(input.text, hasRecallWindow);
  const planP = quick
    ? Promise.resolve(quick)
    : planTurn({ model: models.fast, text: input.text, history, now, hasRecallWindow, signal: input.signal });
  // The early search is real work, so it is announced like any other search
  // (the UI hands the stage to the search dog while it runs).
  const earlyP = web && !hasRecallWindow && looksLikeQuestion(input.text) ? earlySearch(web, input, budget, emit) : Promise.resolve(null);
  const plan: Plan = await planP;
  const tier = decideTier(plan, { text: input.text, hasRecallWindow });
  mark('plan');
  emit({ type: 'step', id: 'plan', label: `Plan: ${tier}`, status: 'done' });
  emit({ type: 'plan', tier, topics: plan.topics });

  // Memory: always cheap (local SQLite), so recall whenever the turn might lean on the past.
  let pack: MemoryPack | null = null;
  if (tier !== 'chat' || hasRecallWindow) {
    pack = recall(memory, {
      text: input.text,
      now,
      timeZone: input.timeZone,
      topics: plan.topics,
      // Fresh questions only pull in past chats that closely match; memory questions match loosely.
      strictTopics: tier === 'lookup' || tier === 'research' || tier === 'chat',
    });
    mark('recall');
    const found = pack.turns.length + pack.claims.length + pack.collections.length;
    // A visible step only when the turn actually leans on the past (the UI hands off to the memory dog).
    if (found > 0 || pack.windows.length > 0 || tier === 'recall' || tier === 'recheck') {
      emit({ type: 'step', id: 'memory', label: 'Digging through memory', status: 'running' });
      emit({
        type: 'step',
        id: 'memory',
        label: found ? `Dug up ${found} ${found === 1 ? 'memory' : 'memories'}` : 'Nothing in memory for that',
        status: 'done',
      });
    }
    if (pack.windows.length || pack.turns.length || pack.claims.length) {
      emit({
        type: 'memory',
        turns: pack.turns.map((t) => ({ at: t.at.toISOString(), role: t.role, text: t.text.slice(0, 280) })),
        claims: pack.claims.map((c) => ({
          entity: c.entity,
          attribute: c.attribute,
          value: c.value,
          asOf: c.asOf.toISOString(),
          superseded: c.superseded,
        })),
        collections: pack.collections.map((c) => ({ name: c.name, members: c.members })),
        emptyDays: pack.emptyWindows.map((w) => w.phrase),
      });
    }
  }

  let recheck: RecheckRow[] | null = null;
  if (tier === 'recheck' && web && pack?.claims.length) {
    recheck = await recheckClaims({ claims: pack.claims, web, model: models.fast, sources, emit, now, budget, signal: input.signal });
    emit({ type: 'recheck', rows: recheck });
    mark('recheck');
  }

  const early = SEARCH_TIERS.has(tier) ? await earlyP : null;
  const earlyForModel = early ? sources.forModel(early, budget.excerptChars) : [];

  const context = contextBlock({ now, timeZone: input.timeZone, tier, pack, recheck, early: earlyForModel });
  const userTurn = memory.addTurn({ threadId: input.threadId, role: 'user', text: input.text, at: now, timeZone: input.timeZone });

  const answerText = await streamAnswer({
    budget,
    model: models.answer,
    web,
    sources,
    context,
    history,
    text: input.text,
    allowSearch: SEARCH_TIERS.has(tier) || (tier === 'recall' && /\b(now|today|current|still)\b/i.test(input.text)),
    emit,
    signal: input.signal,
  });
  mark('answer');

  // A turn's timestamp is when it was asked; the answer follows a moment later.
  const answerAt = new Date(Math.max(input.clock.now().getTime(), userTurn.at.getTime() + 1));
  const answer = memory.addTurn({ threadId: input.threadId, role: 'assistant', text: answerText, at: answerAt, timeZone: input.timeZone });

  const memoryWrite = writeMemory({
    memory,
    model: models.fast,
    userText: input.text,
    answer,
    sources: sources.list(),
    recheck,
  }).catch((err) => console.warn('[memory] write failed:', (err as Error).message));

  emit({ type: 'done', tier, timings, turnId: answer.id });
  return { memoryWrite };
}

/** Search the raw question while the planner thinks; never fails the turn. */
async function earlySearch(web: WebSearch, input: TurnInput, budget: Budget, emit: Emit) {
  const query = input.text.slice(0, 300);
  const short = query.length > 60 ? `${query.slice(0, 57)}…` : query;
  emit({ type: 'step', id: 'search-early', label: `Searching: ${short}`, status: 'running' });
  try {
    const results = await web.search({ query, maxResults: budget.earlyResults }, input.signal);
    emit({ type: 'step', id: 'search-early', label: `Searched: ${short}`, status: 'done' });
    return results;
  } catch {
    emit({ type: 'step', id: 'search-early', label: `Search failed: ${short}`, status: 'failed' });
    return null;
  }
}

function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.split(/\s+/).length >= 4 && (/\?$/.test(t) || /^(what|which|who|when|where|how|is|are|does|do|can|should|compare|best|latest)\b/i.test(t));
}
