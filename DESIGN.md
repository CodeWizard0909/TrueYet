# Design

**In one line:** web search answers what's true now; a dated memory remembers what was true then; the agent's job is to notice the difference.

## How it works

```
message ─► resolve dates (chrono, user's timezone, injectable "now")
        ─► plan (fast model, JSON) ‖ recall (SQLite) ‖ speculative search
        ─► tier: chat · recall · lookup · research · recheck
        ─► recheck old claims in parallel (recheck tier only)
        ─► answer (strong model, one tool: web_search, a fixed search allowance) ─► stream to UI
        ─► save turns ─► extract claims + collections in the background
```

- **Memory is a pipeline step, not a tool.** The rules allow one tool, and date maths is too important to leave to the model. "Last Tuesday" becomes a real time range in code before the model sees anything ([ADR 1](docs/adr/0001-memory-is-a-pipeline-stage-not-a-tool.md), [ADR 4](docs/adr/0004-deterministic-dates-and-an-injectable-now.md)).
- **Memory stores claims, not just chat.** After an answer, a fast model pulls out checkable facts, each with an entity, attribute, value, as-of time and source URL, plus *collections* like "the 5 CRMs we shortlisted". Claims are never overwritten; a newer one supersedes the old, so "what did you tell me then?" still works ([ADR 2](docs/adr/0002-store-dated-claims-not-just-transcripts.md)).
- **Recall is date-first, then topic.** Turns in the recalled window that match the topic; if none match, the best topic match from any day (people misremember days); if the day is empty, the agent says so and offers the nearest days rather than inventing anything.
- **Recheck is a real comparison.** For each remembered claim: search, have the fast model extract *only* the current value from fresh page text, then decide changed / unchanged / couldn't verify **in code**. The model can't talk itself into "unchanged".
- **Provider-agnostic.** Claude (Haiku + Sonnet), Gemini (Flash-Lite + 3.5 Flash) or Groq (gpt-oss 20b + 120b), picked from whichever key is set; the agent code never names a provider.
- **Web text is data, not instructions.** Memory, recheck rows and search excerpts reach the answer model inside tags in the user turn, never in the system prompt, so a web page can't give the agent orders.
- **Fast by default.** Planning, recall and a speculative search run at once; chat and recall skip search; Exa is the default provider (sub-second, most accurate in 2026 benchmarks) with Brave as a fallback; results are cached for an hour; the stable system prompt is cached by the provider; memory writes happen after the answer has streamed.
- **It always answers.** Every model and search call has a timeout. If the planner fails, rules pick the tier. If the model spends its whole search allowance (6 searches, 2 on free tiers) without writing, a final pass answers from what was gathered.
- **The work is visible.** The server streams each step as an event; the UI's four dogs (the Savvy Paws) show who is planning, searching, remembering and rechecking, from those same events.
- **Trustworthy output.** Every web fact is cited `[n]`, prices come from fetched page text rather than snippets, dates are explicit ("as of 3 Nov 2026"), and the UI shows exactly what was remembered.

## Why this shape

All three example questions are about **time**: what was said on a day, and whether it still holds. I checked how the leading assistants handle this: Perplexity, ChatGPT, Claude and Gemini all use memory for personalisation (who you are, what you like). None documents recall by date or re-checking a past answer. I can't out-search Perplexity's index, so the design competes where they don't: memory that knows *when*, and a recheck that shows *what changed*. That's also minimi's own idea (catching open loops), applied to facts.

## Considered and rejected

| Option | Why not |
|---|---|
| Stuff the whole history into the prompt | Gets slower and more expensive every day, and degrades as history grows. |
| Memory as a model tool | Breaks the one-tool rule, and models often forget to call it. |
| Let the model work out dates | Unreliable at calendar maths, and the dataset is built on exactly these phrases. |
| Vector database / embeddings | An extra service, and it sends memory off the machine. Date filtering plus keyword and entity matching covers this dataset. |
| LangChain, multi-agent setups | Extra layers and latency for no gain at this size. |
| Tavily | Slower and less accurate than Exa and Brave in the 2026 search benchmarks. |
| Summarising each conversation | Loses the exact values and sources a recheck needs. |

## Testing

78 unit and integration tests (`npm test`) cover date resolution across every weekday and timezone edge, recall, claim superseding, verdicts, citation clean-up, search failover and caching, the full pipeline with mock models, a model that never stops searching, and the SSE server. `npm run eval` runs the challenge's scenarios against real models and the live web, and reports first-token latency (p50/p95). `NOW` / `X-Now` fix the clock, so a week of history can be tested in a minute.

Latest run (11 Nov 2026, Groq free tier, gpt-oss-20b / 120b, live Exa search): **7/7 passed**, first token p50 **2.4s**. Recall answers in under 1.3s, single rechecks in 3 to 4.5s. The heaviest case (rechecking a 5-tool shortlist) took 12.8s; an earlier run took 38s, almost all of it waiting on the free plan's 8K tokens-per-minute cap, which is why the agent has a tighter context budget on free tiers.

## With another week

1. **Background rechecks.** Re-verify claims as they go stale, then open with "2 things from your CRM shortlist changed since Monday" only when it's true.
2. **Local embeddings** for fuzzy recall ("that database thing") without sending memory anywhere.
3. **Source quality scoring**, preferring vendor pages and penalising SEO aggregators automatically.
4. **A bigger eval set** with a model-graded rubric, run on every change, plus tuning the claim extractor against it.
5. **Stricter memory and verdicts.** Check each extracted value against its source excerpt before storing it, recheck against the claim's original source page first, and compare typed values (amount, unit, period) so "$19/month" and "$19/month, billed yearly" don't read as a change.
