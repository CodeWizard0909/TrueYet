import type { Claim, Collection, Memory, Turn } from './store.ts';
import { resolveRecallWindows, type RecallWindow } from './time.ts';

export interface RecallRequest {
  text: string;
  now: Date;
  timeZone: string;
  /** What the user is asking about, as extracted by the planner ("Postgres hosting"). */
  topics?: string[];
  /** Match every meaningful topic word, not any. For fresh lookups, where only a close match is relevant. */
  strictTopics?: boolean;
}

/** Everything memory can tell the model about a user message. */
export interface MemoryPack {
  windows: RecallWindow[];
  turns: Turn[];
  claims: Claim[];
  collections: Collection[];
  /** Windows the user pointed at that contain no conversation. */
  emptyWindows: RecallWindow[];
  /** When nothing was found for a window: the closest days that do have conversation. */
  nearestDays: string[];
}

/**
 * Date first, then topic: turns in the recalled windows that match the topic;
 * if none match, the best topic matches from any time (people misremember
 * days); if the topic matches nothing, the windows' turns as they are.
 */
export function recall(memory: Memory, req: RecallRequest): MemoryPack {
  const windows = resolveRecallWindows(req.text, req.now, req.timeZone);
  const topics = (req.topics ?? []).filter((t) => t.trim());

  const windowTurns: Turn[] = [];
  const emptyWindows: RecallWindow[] = [];
  for (const w of windows) {
    const found = memory.turnsBetween(w.start, w.end);
    if (found.length === 0) emptyWindows.push(w);
    windowTurns.push(...found);
  }

  let turns = windowTurns;
  if (topics.length > 0) {
    const matches = dedupe(topics.flatMap((t) => memory.searchTurns(t, 12, req.strictTopics ? 'all' : 'any')));
    const inWindow = matches.filter((m) => windowTurns.some((w) => w.id === m.id));
    if (inWindow.length > 0) turns = withPartners(memory, inWindow);
    else if (matches.length > 0) turns = withPartners(memory, closestFirst(matches, windows).slice(0, 4));
  }
  turns = dedupe(turns);

  const collections = memory.findCollections({ topics, windows });
  const claims = dedupeClaims([
    ...memory.claimsForTurns(turns.map((t) => t.id)),
    ...memory.latestClaimsFor(collections.flatMap((c) => c.members)),
  ]);

  const nearestDays =
    emptyWindows.length > 0 && turns.length === 0 ? memory.daysNear(emptyWindows[0]!.start) : [];
  return { windows, turns, claims, collections, emptyWindows, nearestDays };
}

function withPartners(memory: Memory, turns: Turn[]): Turn[] {
  return turns.flatMap((t) => [t, memory.partnerOf(t)].filter((x): x is Turn => x !== null));
}

function closestFirst(turns: Turn[], windows: RecallWindow[]): Turn[] {
  if (windows.length === 0) return turns;
  const distance = (t: Turn) =>
    Math.min(...windows.map((w) => Math.abs(t.at.getTime() - (w.start.getTime() + w.end.getTime()) / 2)));
  return [...turns].sort((a, b) => distance(a) - distance(b));
}

function dedupe(turns: Turn[]): Turn[] {
  const seen = new Set<number>();
  return turns
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
}

function dedupeClaims(claims: Claim[]): Claim[] {
  const seen = new Set<number>();
  return claims.filter((c) => !seen.has(c.id) && seen.add(c.id));
}
