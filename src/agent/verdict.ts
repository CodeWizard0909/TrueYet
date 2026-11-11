export type Verdict = 'changed' | 'unchanged' | 'unverified';

/**
 * Compares a remembered value with today's. Numbers decide when present, so
 * "$20/seat/month" and "$20 per seat per month" are the same claim; otherwise
 * normalised wording decides. Deliberately conservative: anything the model
 * could not find is "unverified", never "unchanged".
 */
export function verdictFor(then: string, now: string | null | undefined): Verdict {
  if (now == null || !now.trim()) return 'unverified';

  const a = numbers(then);
  const b = numbers(now);
  if (a.length > 0 || b.length > 0) {
    return a.length === b.length && a.every((n, i) => n === b[i]) ? 'unchanged' : 'changed';
  }
  return words(then) === words(now) ? 'unchanged' : 'changed';
}

function numbers(s: string): number[] {
  return (s.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? []).map(Number);
}

function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
