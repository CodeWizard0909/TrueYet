// Loads a week of demo conversation into the local memory DB, dated relative to now.
// Run `npm run seed`, then `npm run dev`, and ask the questions printed below.
import { clockFor } from '../src/lib/clock.ts';
import { openMemory } from '../src/memory/store.ts';
import { DEMO_HISTORY, loadHistory, spokenDate } from './history.ts';

const timeZone = process.env.SEED_TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const now = clockFor().now();
const memory = openMemory(process.env.DB_PATH ?? './data/memory.db');

// Re-running replaces the demo week instead of stacking another copy on top.
const removed = memory.deleteThread('seed-history');
if (removed) console.log(`Replaced the previous demo history (${removed} turns).`);
loadHistory(memory, DEMO_HISTORY, { now, timeZone, threadId: 'seed-history' });
memory.close();

console.log(`Seeded ${DEMO_HISTORY.length} past conversations (timezone ${timeZone}). Try asking:`);
console.log(`  • What did I ask you on ${spokenDate({ daysAgo: 8 }, now, timeZone)}? Is your answer still correct today?`);
console.log('  • Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?');
console.log('  • On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?');
console.log('Note: these are demo conversations with illustrative values, so rechecks will show what changed.');
