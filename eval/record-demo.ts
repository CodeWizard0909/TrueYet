// Records a real answer (real model, live web search, demo history in memory) for the
// UI's demo replay mode. Uses API quota once; the replay then costs nothing.
//   npm run record-demo -- <id> "<question>"
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AgentEvent } from '../src/agent/events.ts';
import { budgetFor, modelConfig, modelsFromEnv, MISSING_KEY_MESSAGE } from '../src/agent/models.ts';
import { runTurn } from '../src/agent/pipeline.ts';
import { systemClock } from '../src/lib/clock.ts';
import { openMemory } from '../src/memory/store.ts';
import { createWebSearch, providersFromEnv } from '../src/search/web.ts';
import { DEMO_HISTORY, loadHistory } from './history.ts';

const [id, ...words] = process.argv.slice(2);
const question = words.join(' ').trim();
if (!id || !/^[a-z0-9-]+$/.test(id) || !question) {
  console.error('Usage: npm run record-demo -- <id> "<question>"   (id: lowercase letters, digits, dashes)');
  process.exit(1);
}
const config = modelConfig();
if (!config.provider) {
  console.error(MISSING_KEY_MESSAGE);
  process.exit(1);
}

const timeZone = 'Asia/Kolkata';
const memory = openMemory(':memory:');
loadHistory(memory, DEMO_HISTORY, { now: systemClock.now(), timeZone, threadId: 'history' });

const events: [number, AgentEvent][] = [];
const start = performance.now();
const { memoryWrite } = await runTurn(
  { memory, web: createWebSearch({ providers: providersFromEnv(), memory }), models: modelsFromEnv(), budget: budgetFor(config.provider) },
  { threadId: 'demo', text: question, timeZone, clock: systemClock },
  (e) => events.push([Math.round(performance.now() - start), e]),
);
await memoryWrite;
memory.close();

const failed = events.find(([, e]) => e.type === 'error');
if (failed || !events.some(([, e]) => e.type === 'done')) {
  console.error('Not saved: the run did not finish cleanly.', failed ? JSON.stringify(failed[1]) : '');
  process.exit(1);
}

mkdirSync('web/src/demo', { recursive: true });
const file = `web/src/demo/${id}.json`;
writeFileSync(
  file,
  JSON.stringify({ id, question, recordedAt: new Date().toISOString(), provider: config.provider, models: { fast: config.fast, answer: config.answer }, events }, null, 1),
);
const steps = events.filter(([, e]) => e.type === 'step' && e.status === 'running').map(([, e]) => (e as { id: string }).id);
console.log(`Saved ${file}: ${events.length} events, ${(events[events.length - 1]![0] / 1000).toFixed(1)}s, steps: ${steps.join(', ')}`);
