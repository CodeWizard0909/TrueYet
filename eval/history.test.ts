import { describe, expect, it } from 'vitest';
import { resolveRecallWindows, localDate } from '../src/memory/time.ts';
import { dayOf, spokenDate } from './history.ts';

const tz = 'Asia/Kolkata';
const iso = ([y, m, d]: [number, number, number]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

describe('demo history dates agree with the recall resolver', () => {
  // Every weekday, so the seed is right whatever day it runs.
  for (let i = 0; i < 7; i++) {
    const now = new Date(Date.UTC(2026, 10, 9 + i, 6)); // 9–15 Nov 2026
    it(`"last Tuesday" and "on Monday" match the seeded days when today is ${now.toUTCString().slice(0, 3)}`, () => {
      const tuesday = resolveRecallWindows('Last Tuesday I asked you', now, tz)[0]!;
      const monday = resolveRecallWindows('On Monday we shortlisted', now, tz)[0]!;
      expect(localDate(tuesday.start, tz)).toBe(iso(dayOf({ weekday: 'Tuesday' }, now, tz)));
      expect(localDate(monday.start, tz)).toBe(iso(dayOf({ weekday: 'Monday' }, now, tz)));
    });
  }

  it('speaks an explicit date the way users write it', () => {
    expect(spokenDate({ daysAgo: 8 }, new Date('2026-11-11T06:00:00Z'), tz)).toBe('3 November');
  });
});
