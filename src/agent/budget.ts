/**
 * How much context the agent sends per call. Free tiers cap tokens per
 * minute (Groq: 8K), and an answer re-sends its whole context on every search
 * round, so the budget bounds excerpts, results, rounds and history together.
 */
export interface Budget {
  /** Characters of page text per search result the answer model sees. */
  excerptChars: number;
  resultsPerSearch: number;
  /** Results from the speculative search that runs alongside planning. */
  earlyResults: number;
  /** Tool-calling rounds before the model must answer. */
  searchRounds: number;
  /** Web searches the answer model may run in one turn; past this the tool declines. */
  maxSearches: number;
  recheckClaims: number;
  recheckResults: number;
  recheckExcerptChars: number;
  historyTurns: number;
  historyChars: number;
}

export const ROOMY: Budget = {
  excerptChars: 1800,
  resultsPerSearch: 6,
  earlyResults: 5,
  searchRounds: 3,
  maxSearches: 6,
  recheckClaims: 8,
  recheckResults: 4,
  recheckExcerptChars: 2000,
  historyTurns: 10,
  historyChars: 4000,
};

/**
 * Fits Groq's free plan (8K tokens a minute per model). Each search round re-sends the whole
 * context, so a 4-call answer must stay around 7K tokens in total: ~1.3K base, ~400 per search.
 */
export const TIGHT: Budget = {
  excerptChars: 500,
  resultsPerSearch: 3,
  earlyResults: 3,
  searchRounds: 2,
  maxSearches: 2,
  recheckClaims: 5,
  recheckResults: 3,
  recheckExcerptChars: 600,
  historyTurns: 4,
  historyChars: 600,
};
