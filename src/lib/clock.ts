/** The single source of "now" for the agent. Fixed clocks make memory testable across days. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(at: Date | string): Clock {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) throw new Error(`Invalid fixed time: ${String(at)}`);
  return { now: () => new Date(instant) };
}

/**
 * Picks the clock for a request: an explicit override (X-Now header) wins,
 * then the NOW env var, then real time.
 */
export function clockFor(override?: string | null, env = process.env.NOW): Clock {
  if (override) return fixedClock(override);
  if (env) return fixedClock(env);
  return systemClock;
}
