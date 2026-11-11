# TrueYet

Is what your AI told you still true? TrueYet is a chat agent with one tool, web search, and a memory that knows **what was true, and when**. Ask it something today; next week, ask what you asked, or whether that answer still holds, and it checks.

See [DESIGN.md](DESIGN.md) for why it is built this way.

## Run it

Needs Node 22.13 or newer (it uses the built-in SQLite).

```bash
npm install
cp .env.example .env    # add a model key (Anthropic, Gemini or Groq) and EXA_API_KEY
npm run dev             # http://localhost:5173
```

On Windows PowerShell, use `Copy-Item .env.example .env`. Groq's free tier needs no card and is enough to run everything.

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

## Architecture

```
 Browser (React)                      Server (Hono)
 ┌──────────────────────┐   POST    ┌────────────────────────────────────────────┐
 │ chat + the Savvy Paws│ ────────► │ one turn = one pipeline run                │
 │ steps, sources,      │ ◄──────── │                                            │
 │ memory, recheck table│   SSE     │ 1 resolve dates      code, user's timezone │
 └──────────────────────┘  events   │ 2 plan ‖ recall ‖ early search   (at once) │
                                    │ 3 pick a tier        chat · recall · lookup│
                                    │                      · research · recheck  │
                                    │ 4 recheck old claims verdict set in code   │
                                    │ 5 answer             streams, cites [n]    │
                                    │ 6 save turns, then extract claims (after)  │
                                    └──────┬───────────────┬───────────────┬─────┘
                                           ▼               ▼               ▼
                                     Memory            Web search        Models
                                     SQLite + FTS5     Exa → Brave       fast + answer
                                     turns, claims,    1h cache,         Anthropic, Gemini
                                     collections       page text         or Groq
```

- **One tool.** The answer model can call `web_search` and nothing else. Memory is a pipeline step in code, not a tool the model might forget to call.
- **Dates are worked out in code.** "Last Tuesday" becomes an exact time range in the user's timezone before any model sees the message.
- **Memory keeps claims, not just chat.** Each checkable fact is stored with its value, the moment it was true and its source. A newer claim supersedes the old one; nothing is overwritten.
- **Recheck is a real comparison.** A fast model only extracts today's value from fresh page text; code decides changed, unchanged or couldn't verify.
- **Web text is data.** Memory, recheck rows and search excerpts reach the model inside tags in the user turn, never in the system prompt.
- **It always answers.** Every model and search call has a timeout, search fails over to a second provider, and if a model uses up its steps searching, a final pass writes the answer from what was found.
- **Two models.** A small fast one plans and extracts; a stronger one writes the answer. The agent code never names a provider.

### The Savvy Paws

The four dogs in the UI show which part of the pipeline is working, driven by the same events the server streams.

| Dog | Job |
|---|---|
| Biscuit | Plans the turn and writes the answer |
| Scout | Searches the web |
| Bones | Digs through memory |
| Watch | Rechecks old claims |

### Checked by

78 tests that need no keys (`npm test`), and 7 live scenarios against real models and the live web (`npm run eval`): last run 7/7 on Groq's free tier.

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
