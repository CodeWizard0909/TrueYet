# TrueYet

Is what your AI told you still true? TrueYet is a chat agent with one tool, web search, and a memory that knows **what was true, and when**. Ask it something today; next week, ask what you asked, or whether that answer still holds, and it checks.

See [DESIGN.md](DESIGN.md) for how it works and why.

## Run it

Needs Node 22.13 or newer (it uses the built-in SQLite).

```bash
npm install
cp .env.example .env    # add a model key (Anthropic or Gemini) and EXA_API_KEY
npm run dev             # http://localhost:5173
```

| Key | Needed | What for |
|---|---|---|
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` or `GROQ_API_KEY` | one of them | Planning, answers, memory extraction |
| `MODEL_PROVIDER` | optional | Force `anthropic`, `google` or `groq` when several keys are set |
| `EXA_API_KEY` | yes (or Brave) | Web search |
| `BRAVE_API_KEY` | optional | Fallback search provider |
| `NOW` | optional | Freeze "now" to test memory across days |

## Try the memory without waiting a week

```bash
npm run seed
```

This loads a week of demo conversations (Postgres hosting, a CRM shortlist), dated relative to today. Then ask:

- *What did I ask you on 3 November? Is your answer still correct today?* (it prints the right date for you)
- *Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?*
- *On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing since?*

**No keys at hand?** Open http://localhost:5173/?demo=1 to replay real recorded answers (one search, one recheck that uses all four dogs) with no API calls. Record your own with `npm run record-demo -- <id> "<question>"`.

You can also set **Pretend now** in the header (or send an `X-Now` header) to chat "on" any day.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (port 8787) and web UI (port 5173) |
| `npm test` | Unit and integration tests, no keys needed |
| `npm run eval` | Challenge scenarios against real models and the live web, with latency |
| `npm run seed` | Load demo history into `data/memory.db` |
| `npm run cli -- "question"` | Ask from the terminal |
| `npm run record-demo -- <id> "<question>"` | Record a real answer for the `?demo=1` replay |
| `npm run typecheck` | TypeScript check |

## Layout

```
src/agent/    pipeline, planner, router, answerer, recheck, verdicts, prompts
src/memory/   SQLite store, date resolution, recall, memory writer
src/search/   Exa, Brave, page fetching, cache + failover
src/server/   Hono API with server-sent events
web/          React UI
eval/         demo history, seed, eval runner
docs/adr/     the decisions that shaped it
GLOSSARY.md   the words used in the code
```
