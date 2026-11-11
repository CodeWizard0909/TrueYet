// Runs realistic multi-day scenarios against the real agent (real models, live web).
// Each case gets a fresh in-memory DB with the demo history. Needs the keys in .env.
//   npm run eval            all cases
//   npm run eval -- recheck only cases whose id contains "recheck"
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AgentEvent } from '../src/agent/events.ts';
import { budgetFor, modelConfig, modelsFromEnv, MISSING_KEY_MESSAGE } from '../src/agent/models.ts';
import { runTurn } from '../src/agent/pipeline.ts';
import type { Tier } from '../src/agent/router.ts';
import { systemClock } from '../src/lib/clock.ts';
import { openMemory } from '../src/memory/store.ts';
import { createWebSearch, providersFromEnv } from '../src/search/web.ts';
import { DEMO_HISTORY, loadHistory, spokenDate } from './history.ts';

interface Case {
  id: string;
  question: string;
  tiers: Tier[];
  mustMatch?: RegExp[];
  mustNotMatch?: RegExp[];
  citations?: boolean;
  searches?: boolean;
  recheckRows?: boolean;
}

const timeZone = 'Asia/Kolkata';
const now = systemClock.now();
const eightDaysAgo = spokenDate({ daysAgo: 8 }, now, timeZone);
const twentyDaysAgo = spokenDate({ daysAgo: 20 }, now, timeZone);

const CASES: Case[] = [
  {
    id: 'recall-explicit-date',
    question: `What did I ask you on ${eightDaysAgo}?`,
    tiers: ['recall'],
    mustMatch: [/postgres/i, /side project|free tier/i],
    searches: false,
  },
  {
    id: 'recall-empty-day',
    question: `What did I ask you on ${twentyDaysAgo}?`,
    tiers: ['recall'],
    mustMatch: [/(no|don't|do not|didn't|did not|couldn't|can't).{0,40}(conversation|record|chat|anything|find)/i],
    mustNotMatch: [/you asked (me )?about/i],
    searches: false,
  },
  {
    id: 'recheck-still-correct',
    question: `What did I ask you on ${eightDaysAgo}? Is your answer still correct today?`,
    tiers: ['recheck'],
    mustMatch: [/neon/i, /supabase/i],
    citations: true,
    recheckRows: true,
  },
  {
    id: 'recheck-postgres-since-tuesday',
    question: 'Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?',
    tiers: ['recheck'],
    mustMatch: [/neon/i, /supabase/i, /rds/i],
    citations: true,
    recheckRows: true,
  },
  {
    id: 'recheck-crm-shortlist',
    question:
      'On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?',
    tiers: ['recheck'],
    mustMatch: [/hubspot/i, /pipedrive/i, /zoho/i, /salesforce/i, /freshsales/i],
    citations: true,
    recheckRows: true,
  },
  {
    id: 'lookup-fresh-fact',
    question: 'What is the latest LTS version of Node.js?',
    tiers: ['lookup', 'research'],
    mustMatch: [/\d+/],
    citations: true,
    searches: true,
  },
  {
    id: 'chat-small-talk',
    question: 'thanks, that was helpful!',
    tiers: ['chat'],
    searches: false,
  },
];

interface Outcome {
  id: string;
  pass: boolean;
  failures: string[];
  tier?: Tier;
  firstTokenMs: number | null;
  totalMs: number;
  timings: Record<string, number>;
  answer: string;
}

async function runCase(c: Case): Promise<Outcome> {
  const memory = openMemory(':memory:');
  loadHistory(memory, DEMO_HISTORY, { now, timeZone, threadId: 'history' });
  const providers = providersFromEnv();
  const web = providers.length ? createWebSearch({ providers, memory }) : null;

  const events: AgentEvent[] = [];
  const start = performance.now();
  let firstTokenMs: number | null = null;
  let totalMs = 0;
  try {
    const { memoryWrite } = await runTurn(
      { memory, web, models: modelsFromEnv(), budget: budgetFor(modelConfig().provider) },
      { threadId: `eval-${c.id}`, text: c.question, timeZone, clock: systemClock },
      (e) => {
        if (e.type === 'text' && firstTokenMs === null) firstTokenMs = Math.round(performance.now() - start);
        events.push(e);
      },
    );
    totalMs = Math.round(performance.now() - start);
    await memoryWrite; // background in the app; awaited here so the DB isn't closed under it
  } catch (err) {
    totalMs = Math.round(performance.now() - start);
    events.push({ type: 'error', message: (err as Error).message });
  }
  memory.close();

  const answer = events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('');
  const done = events.find((e) => e.type === 'done');
  const tier = done?.type === 'done' ? done.tier : undefined;
  const searched = events.some((e) => e.type === 'step' && e.id.startsWith('search-'));
  const recheck = events.find((e) => e.type === 'recheck');
  const failures: string[] = [];

  for (const e of events) if (e.type === 'error') failures.push(`error: ${e.message}`);
  if (!tier || !c.tiers.includes(tier)) failures.push(`tier ${tier ?? 'none'} not in [${c.tiers}]`);
  for (const re of c.mustMatch ?? []) if (!re.test(answer)) failures.push(`missing ${re}`);
  for (const re of c.mustNotMatch ?? []) if (re.test(answer)) failures.push(`should not match ${re}`);
  if (c.citations && !/\[\d+(\s*,\s*\d+)*\]/.test(answer)) failures.push('no [n] citations');
  if (c.searches === false && searched) failures.push('searched when it should not');
  if (c.searches === true && !searched && !events.some((e) => e.type === 'source')) failures.push('did not search');
  if (c.recheckRows && !(recheck?.type === 'recheck' && recheck.rows.length > 0)) failures.push('no recheck rows');

  const timings = done?.type === 'done' ? done.timings : {};
  return { id: c.id, pass: failures.length === 0, failures, tier, firstTokenMs, totalMs, timings, answer };
}

if (!modelConfig().provider) {
  console.error(MISSING_KEY_MESSAGE);
  process.exit(1);
}

const filter = process.argv[2];
const selected = CASES.filter((c) => !filter || c.id.includes(filter));
console.log(`Running ${selected.length} cases with ${modelConfig().provider} (${modelConfig().fast} / ${modelConfig().answer}) (now = ${now.toISOString()}, tz = ${timeZone})\n`);

const outcomes: Outcome[] = [];
for (const c of selected) {
  const o = await runCase(c);
  outcomes.push(o);
  const first = o.firstTokenMs === null ? '–' : `${(o.firstTokenMs / 1000).toFixed(1)}s`;
  console.log(`${o.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(32)} ${String(o.tier ?? '-').padEnd(9)} first token ${first.padStart(5)}  total ${(o.totalMs / 1000).toFixed(1)}s`);
  console.log(`        stages: ${Object.entries(o.timings).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(" · ")}`);
  for (const f of o.failures) console.log(`        - ${f}`);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0;
};
const firsts = outcomes.flatMap((o) => (o.firstTokenMs === null ? [] : [o.firstTokenMs]));
const passed = outcomes.filter((o) => o.pass).length;
console.log(`\n${passed}/${outcomes.length} passed · first token p50 ${(pct(firsts, 50) / 1000).toFixed(1)}s, p95 ${(pct(firsts, 95) / 1000).toFixed(1)}s`);

mkdirSync('eval/results', { recursive: true });
const file = `eval/results/${now.toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(outcomes, null, 2));
console.log(`Full answers saved to ${file}`);
process.exit(passed === outcomes.length ? 0 : 1);
