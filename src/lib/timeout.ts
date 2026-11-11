/**
 * A signal that aborts when the caller aborts or after `ms`, whichever comes
 * first. Every model and search call gets one: a provider that never answers
 * must fail a step, not freeze the turn.
 */
export function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timer = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timer]) : timer;
}

export const TIMEOUTS = {
  plan: 12_000,
  search: 12_000,
  extract: 20_000,
  answer: 90_000,
  memoryWrite: 45_000,
} as const;
