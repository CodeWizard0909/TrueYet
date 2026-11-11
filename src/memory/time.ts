import * as chrono from 'chrono-node';

/** A span of real time, inclusive of both ends. */
export interface RecallWindow {
  start: Date;
  end: Date;
  /** The words in the user's message that produced this window. */
  phrase: string;
}

const PRESENT_WORDS = /^(today|now|right now|currently|tonight|this (morning|afternoon|evening))$/i;
const TALKS_ABOUT_OUR_CHAT = /\b(i|we|you)\s+(asked|ask|said|told|talked|discussed|chatted|mentioned|shortlisted|compared)\b|\bdid i\b|\bour (chat|conversation)\b/i;
const DAY_MS = 86_400_000;

/**
 * Turns time references in a user's message ("last Tuesday", "3 November")
 * into whole local days in the user's timezone. Never returns a window that
 * starts in the future: people recall the past.
 */
export function resolveRecallWindows(text: string, now: Date, timeZone: string): RecallWindow[] {
  const results = chrono.parse(
    text,
    { instant: now, timezone: offsetMinutes(timeZone, now) },
    { forwardDate: false },
  );

  const dated = results.filter(
    (r) => r.start.isCertain('day') || r.start.isCertain('weekday') || r.start.isCertain('month'),
  );
  // "today"/"right now" point at our conversation only when the message is about it
  // ("what did I ask you today?"); in "best camera right now" they just mean "current".
  const aboutOurChat = dated.length > 1 || TALKS_ABOUT_OUR_CHAT.test(text);
  const past = dated.filter((r) => !PRESENT_WORDS.test(r.text.trim()) || (aboutOurChat && dated.length === 1));

  return past.map((r) => {
    let { year, month, day } = {
      year: r.start.get('year')!,
      month: r.start.get('month')!,
      day: r.start.get('day')!,
    };
    let start = localMidnight(year, month, day, timeZone);
    const bareWeekday = r.start.isCertain('weekday') && !r.start.isCertain('day');
    const isToday = localDate(start, timeZone) === localDate(now, timeZone);

    if (start.getTime() > now.getTime() || (bareWeekday && isToday)) {
      if (bareWeekday) {
        start = localMidnight(year, month, day - 7, timeZone);
      } else if (!r.start.isCertain('year')) {
        year -= 1;
        start = localMidnight(year, month, day, timeZone);
      }
    }

    let end = new Date(start.getTime() + DAY_MS - 1);
    if (r.end) {
      const endStart = localMidnight(r.end.get('year')!, r.end.get('month')!, r.end.get('day')!, timeZone);
      if (endStart > start) end = new Date(endStart.getTime() + DAY_MS - 1);
    }
    return { start, end, phrase: r.text };
  });
}

/** The calendar date (in `timeZone`) of an instant, as YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  );
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (IST = 330). */
export function offsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** The instant local midnight starts on a calendar day in `timeZone`. Day overflow is normalised. */
export function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const offset = offsetMinutes(timeZone, utcGuess);
  const candidate = new Date(utcGuess.getTime() - offset * 60_000);
  // Correct once in case the offset differs on the other side of a DST change.
  const corrected = offsetMinutes(timeZone, candidate);
  return corrected === offset ? candidate : new Date(utcGuess.getTime() - corrected * 60_000);
}

/** True if the string is an IANA timezone this runtime understands. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
