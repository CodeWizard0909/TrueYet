// Talk to the agent from a terminal: npm run cli -- "your question"
import { budgetFor, modelConfig, modelsFromEnv } from './agent/models.ts';
import { runTurn } from './agent/pipeline.ts';
import { clockFor } from './lib/clock.ts';
import { openMemory } from './memory/store.ts';
import { createWebSearch, providersFromEnv } from './search/web.ts';

const text = process.argv.slice(2).join(' ').trim();
if (!text) {
  console.error('Usage: npm run cli -- "What did I ask you on 3 November?"');
  process.exit(1);
}

const memory = openMemory(process.env.DB_PATH ?? './data/memory.db');
const providers = providersFromEnv();
const { memoryWrite } = await runTurn(
  { memory, web: providers.length ? createWebSearch({ providers, memory }) : null, models: modelsFromEnv(), budget: budgetFor(modelConfig().provider) },
  { threadId: 'cli', text, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, clock: clockFor() },
  (e) => {
    if (e.type === 'text') process.stdout.write(e.delta);
    else if (e.type === 'step' && e.status !== 'running') console.error(`  · ${e.label}`);
    else if (e.type === 'done') console.error(`\n  [${e.tier}] ${JSON.stringify(e.timings)}`);
    else if (e.type === 'error') console.error(`\nError: ${e.message}`);
  },
);
await memoryWrite;
memory.close();
