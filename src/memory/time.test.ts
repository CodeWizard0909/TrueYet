import { describe, expect, it } from 'vitest';
import { resolveRecallWindows } from './time.ts';

// Wednesday 11 Nov 2026, 10:00 in India (04:30 UTC).
const now = new Date('2026-11-11T04:30:00Z');
const tz = 'Asia/Kolkata';

const day = (isoDate: string) => ({
  start: new Date(`${isoDate}T00:00:00+05:30`).toISOString(),
  end: new Date(`${isoDate}T23:59:59.999+05:30`).toISOString(),
});

const windows = (text: string) =>
  resolveRecallWindows(text, now, tz).map((w) => ({
    start: w.start.toISOString(),
    end: w.end.toISOString(),
  }));

describe('resolveRecallWindows', () => {
  it('resolves an explicit date to that whole local day', () => {
    expect(windows('What did I ask you on 3 November?')).toEqual([day('2026-11-03')]);
  });

  it('resolves a bare weekday to the most recent past one', () => {
    expect(windows('On Monday we shortlisted 5 CRM tools')).toEqual([day('2026-11-09')]);
  });

  it('treats a bare weekday that is today as last week (people say "today" for today)', () => {
    // `now` is a Wednesday.
    expect(windows('On Wednesday we compared CRMs')).toEqual([day('2026-11-04')]);
  });

  it('resolves "last Tuesday" to the most recent Tuesday before today', () => {
    expect(windows('Last Tuesday I asked you about Postgres hosting')).toEqual([day('2026-11-10')]);
  });

  it('resolves "yesterday" in the user timezone, not UTC', () => {
    // 01:00 on 12 Nov in India is still 11 Nov in UTC.
    const lateNight = new Date('2026-11-11T19:30:00Z');
    const result = resolveRecallWindows('what did we talk about yesterday', lateNight, tz);
    expect(result.map((w) => w.start.toISOString())).toEqual([day('2026-11-11').start]);
  });

  it('never points into the future: a date later this year means last year', () => {
    expect(windows('what did I ask on 20 December?')).toEqual([day('2025-12-20')]);
  });

  it('returns nothing when the message has no time reference', () => {
    expect(windows('What is the cheapest Postgres host?')).toEqual([]);
  });
});

describe('resolveRecallWindows with present-tense words', () => {
  it('ignores "today" when it is the comparison point, not the recall target', () => {
    expect(windows('What did I ask you on 3 November? Is your answer still correct today?')).toEqual([
      day('2026-11-03'),
    ]);
  });

  it('keeps "today" when it is the only time reference', () => {
    expect(windows('what did I ask you today?')).toEqual([day('2026-11-11')]);
  });

  it('ignores "right now" / "today" in a fresh question that is not about our past conversation', () => {
    expect(windows('Which phone has the best camera right now?')).toEqual([]);
    expect(windows('What is the price of gold today?')).toEqual([]);
  });
});
