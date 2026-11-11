export const TIERS = ['chat', 'recall', 'lookup', 'research', 'recheck'] as const;
export type Tier = (typeof TIERS)[number];

/** What the planner decided about a user turn. */
export interface Plan {
  tier: Tier;
  /** What the user is asking about, used for memory search ("Postgres hosting"). */
  topics: string[];
  /** Web searches worth running straight away. */
  searchQueries: string[];
}

const ASKS_IF_STILL_TRUE =
  /\b(still (correct|true|valid|accurate|right|the case)|(has|have|did) .{0,40}\b(chang|updat|shipp|launch|releas)|since (then|that|we|i|you)|any (changes|updates|news))/i;
const REFERS_TO_PAST_CHAT = /\b(i asked|we (talked|discussed|shortlisted|compared|looked)|you (said|told|recommended)|earlier|last time)\b/i;

/**
 * Final say on the tier. The planner is a model and can miss the one case the
 * dataset cares most about, so a cheap deterministic check upgrades
 * "did that change since [past conversation]?" to a recheck.
 */
export function decideTier(plan: Plan, signals: { text: string; hasRecallWindow: boolean }): Tier {
  if (plan.tier === 'recheck') return 'recheck';
  const pointsAtPast = signals.hasRecallWindow || REFERS_TO_PAST_CHAT.test(signals.text);
  if (pointsAtPast && ASKS_IF_STILL_TRUE.test(signals.text)) return 'recheck';
  return plan.tier;
}

const SMALL_TALK = /^(hi|hey|hello|thanks|thank you|ok|okay|cool|great|nice|bye)\b[\s!.]*$/i;
const RECALL_PHRASING = /\b(what did (i|we)|did i ask|you (said|told)|remind me what)\b/i;

const THANKS_OR_GREETING = /^(hi|hey|hello|thanks|thank you|ok|okay|cool|great|nice|bye|got it|perfect)\b/i;
const ASKS_FOR_SOMETHING = /\?|\b(compare|what|which|who|how|why|when|find|search|price|show|tell|list|now|also|and then)\b/i;

/**
 * A plan without a model call, for the two cases rules get right every time:
 * small talk, and "what did I ask on <day>?". Returns null to defer to the
 * planner. Saves a full model round trip (~1–3s) on these turns.
 */
export function quickPlan(text: string, hasRecallWindow: boolean): Plan | null {
  const t = text.trim();
  if (THANKS_OR_GREETING.test(t) && t.split(/\s+/).length <= 8 && !ASKS_FOR_SOMETHING.test(t)) {
    return { tier: 'chat', topics: [], searchQueries: [] };
  }
  if (hasRecallWindow && RECALL_PHRASING.test(t) && !ASKS_IF_STILL_TRUE.test(t) && t.split(/\s+/).length <= 14) {
    return { tier: 'recall', topics: [], searchQueries: [] };
  }
  return null;
}

/** A rough plan from rules alone, so the agent still works if the planner call fails. */
export function fallbackPlan(text: string, hasRecallWindow: boolean): Plan {
  const trimmed = text.trim();
  let tier: Tier = 'lookup';
  if (SMALL_TALK.test(trimmed)) tier = 'chat';
  else if (hasRecallWindow || RECALL_PHRASING.test(trimmed)) tier = 'recall';
  return {
    tier,
    topics: [],
    searchQueries: tier === 'lookup' ? [trimmed.slice(0, 200)] : [],
  };
}
