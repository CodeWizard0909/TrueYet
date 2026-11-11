# CLAUDE.md

Context for agents working in this repo. Read `DESIGN.md` (why), `GLOSSARY.md` (words), and `docs/adr/` (decisions) before changing architecture.

## What this is
A chat agent with one tool, web search, and memory that knows **what was true, and when**. Built for the minimi hiring challenge (judged on architecture; needs `npm install` + `npm run dev`, `DESIGN.md`, a 60s video). The product name is **TrueYet**. The dogs are **the Savvy Paws** in anything a user reads (`PACK` stays in code).

## Run
- Node ≥ 22.13 (uses built-in `node:sqlite`). `npm run dev` → API :8787 (`API_PORT`) + web :5173.
- Keys in `.env` (see `.env.example`). The author's working setup: **Groq free tier** (`MODEL_PROVIDER=groq`) + Exa. Anthropic key has no credits; Gemini free quota is ~20 answers/day.
- `npm test` (78 tests, no keys), `npm run typecheck`, `npm run eval` (7 live cases; last result 7/7 on Groq), `npm run seed` (idempotent demo week), `npm run record-demo -- <id> "<q>"`, `npm run cli -- "<q>"`.
- `?demo=1` replays recorded real answers from `web/src/demo/*.json` with no API calls.

## Map
- `src/agent/pipeline.ts`: one turn: resolve dates → plan ‖ recall ‖ early search → tier → recheck → stream answer → save → write memory (async).
- `router.ts` (tiers, `quickPlan` rules, `decideTier` recheck upgrade) · `planner.ts` · `answerer.ts` (single `web_search` tool, search allowance, guaranteed final answer) · `recheck.ts` (one batched extraction; verdict in `verdict.ts`, in code) · `citations.ts` (stream normaliser: `【n】`→`[n]`, U+202F) · `budget.ts` (ROOMY vs TIGHT for free tiers) · `models.ts` (anthropic | google | groq).
- `src/memory/`: `store.ts` (SQLite + FTS5; claims append-only, superseded not overwritten), `recall.ts` (date-first, then topic; `strictTopics` for fresh lookups), `time.ts` (chrono + timezone; never future; "today/right now" only count when the user talks about our chat), `writer.ts`.
- `src/search/`: Exa (`type: lite`) → Brave fallback, 1h cache, page fetch.
- `web/src/`: `App.tsx`, `director.ts` (which dog per step, hand-off trail, `crewStatus`), `Mascot.tsx` (the pack: Biscuit plans/writes, Scout searches, Bones memory, Watch rechecks), `demo.ts`.

## Hard-won gotchas (don't relearn these)
- **Groq strict JSON schema** rejects the whole output on any `max`/`min` violation → never put array limits in zod schemas for model output; slice in code.
- **gpt-oss**: cites as `【4】`; puts U+202F inside numbers; calls a built-in `open` tool that doesn't exist (Groq errors) → caught in `answerer.ts`, finishes without tools; searches one item per step → search allowance + final no-tools answer.
- Removing tools on the last step (`activeTools: []`) makes Groq error. Keep the tool; let it decline.
- Groq free: 8K tokens/min per model → TIGHT budget; eval cases share the minute, so eval latency is pessimistic.
- Gemini: `gemini-flash-latest` hung; `gemini-2.5-flash` retired for new users; `gemini-pro-latest` not on free tier. Use `gemini-3.5-flash`. Lower thinking via `thinkingConfig`.
- Exa `fast`/`instant` are legacy → `lite`.
- Library versions are newer than model training (AI SDK 7: `result.stream`, `isStepCount`, `Output.object`; TS 7; Vite 8; Vitest 5). Read `node_modules/ai/docs` before using an API.
- Every model/search call has a timeout (`src/lib/timeout.ts`).
- Shell: avoid nested heredocs and `node -e` with backticks/quotes on Windows Git Bash; use the Write/Edit tools or a script file.
- `tsx watch` reloads server code, but `.env` is read only at startup.

## Conventions
- **The author commits and pushes themselves.** Never run `git commit`/`git push`; give a short, casual one-line commit message.
- Test-first for logic (seams: date resolver, memory store/recall, verdicts, router, director/crew, citations, answerer with mock models, SSE server). Mocks: `src/agent/testModels.ts`, `MockLanguageModelV4`.
- Verify UI changes in the browser (desktop, phone width, day and night).
- Plain human language in docs, PRs and messages. Keep `DESIGN.md` to one page.
- Keep provider-agnostic: no provider names outside `models.ts`/`budget.ts`.

## Status (11 Nov 2026)
Done and verified: full pipeline, memory + recheck, three providers, demo replay, the pack UI (hand-offs, crew board, 3D motion, bright stages, day/night).
Before submitting: commit + push (public repo, `.env` not committed), fresh-clone test, 60s video (use `?demo=1`), submit the form.