# Store dated claims, not just transcripts

After every answer, a fast model extracts claims (entity, attribute, value, as-of, source) and collections into tables alongside the raw turns. "Has the price changed since Tuesday?" then becomes a comparison between a stored claim and a fresh one, instead of re-reading old chats and hoping the model spots the numbers. Claims are append-only; newer ones supersede older ones rather than overwriting them.

## Considered Options

- **Transcript-only memory with retrieval** (what most assistants do): simpler, but "what changed?" depends on the model re-deriving old values from prose every time.
- **Summaries per conversation**: lose exact values and sources, which are the whole point of a recheck.
