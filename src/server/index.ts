import { serve } from '@hono/node-server';
import { budgetFor, modelConfig, modelsFromEnv, MISSING_KEY_MESSAGE } from '../agent/models.ts';
import { openMemory } from '../memory/store.ts';
import { createWebSearch, providersFromEnv } from '../search/web.ts';
import { createApp } from './app.ts';

const port = Number(process.env.API_PORT ?? 8787);
const memory = openMemory(process.env.DB_PATH ?? './data/memory.db');
const providers = providersFromEnv();

const app = createApp(
  {
    memory,
    web: providers.length ? createWebSearch({ providers, memory }) : null,
    models: modelsFromEnv(),
    budget: budgetFor(modelConfig().provider),
  },
  { hasModelKey: modelConfig().provider !== null, searchProviders: providers.map((p) => p.name) },
);

serve({ fetch: app.fetch, port }, () => {
  console.log(`API on http://localhost:${port}  ·  search: ${providers.map((p) => p.name).join(' → ') || 'NONE (set EXA_API_KEY)'}`);
  const m = modelConfig();
  console.log(m.provider ? `Models: ${m.provider} (${m.fast} / ${m.answer})` : MISSING_KEY_MESSAGE);
  if (process.env.NOW) console.log(`Clock fixed at ${process.env.NOW}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    memory.close();
    process.exit(0);
  });
}
