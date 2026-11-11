import type { Memory, NewClaim } from '../src/memory/store.ts';
import { localDate, localMidnight } from '../src/memory/time.ts';

/**
 * Past conversations described relative to "now", so the seed and the eval
 * work whatever day they are run on.
 */
export interface PastExchange {
  /** When it happened, e.g. { daysAgo: 8 } or { weekday: 'Tuesday' } (the most recent one before today). */
  when: { daysAgo: number } | { weekday: Weekday };
  hour?: number;
  user: string;
  assistant: string;
  claims?: Omit<NewClaim, 'asOf'>[];
  collection?: { name: string; description: string; members: string[] };
}

export type Weekday = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
const WEEKDAYS: Weekday[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Local calendar day for a relative description, as [year, month, day]. */
export function dayOf(when: PastExchange['when'], now: Date, timeZone: string): [number, number, number] {
  const [y, m, d] = localDate(now, timeZone).split('-').map(Number) as [number, number, number];
  const today = new Date(Date.UTC(y, m - 1, d));
  let back: number;
  if ('daysAgo' in when) back = when.daysAgo;
  else {
    back = (today.getUTCDay() - WEEKDAYS.indexOf(when.weekday) + 7) % 7;
    if (back === 0) back = 7;
  }
  const target = new Date(today.getTime() - back * 86_400_000);
  return [target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate()];
}

/** "3 November" for a relative day, to put into questions. */
export function spokenDate(when: PastExchange['when'], now: Date, timeZone: string): string {
  const [y, m, d] = dayOf(when, now, timeZone);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function loadHistory(memory: Memory, history: PastExchange[], opts: { now: Date; timeZone: string; threadId: string }) {
  for (const h of history) {
    const [y, m, d] = dayOf(h.when, opts.now, opts.timeZone);
    const asked = new Date(localMidnight(y, m, d, opts.timeZone).getTime() + (h.hour ?? 10) * 3_600_000);
    const answeredAt = new Date(asked.getTime() + 8_000);
    memory.addTurn({ threadId: opts.threadId, role: 'user', text: h.user, at: asked, timeZone: opts.timeZone });
    const answer = memory.addTurn({ threadId: opts.threadId, role: 'assistant', text: h.assistant, at: answeredAt, timeZone: opts.timeZone });
    if (h.claims?.length) memory.addClaims(answer.id, h.claims.map((c) => ({ ...c, asOf: answeredAt })));
    if (h.collection) memory.addCollection({ ...h.collection, turnId: answer.id, createdAt: answeredAt });
  }
}

/** A realistic week of conversation used by both `npm run seed` and `npm run eval`. */
export const DEMO_HISTORY: PastExchange[] = [
  {
    when: { daysAgo: 8 },
    user: 'Which managed Postgres host should I use for a side project? Mostly care about the free tier.',
    assistant:
      'For a side project, Neon or Supabase. Neon\'s free plan gives 0.5 GB storage per project and scales to zero [1]. ' +
      'Supabase\'s free plan includes a 500 MB database and pauses after a week of inactivity [2].',
    claims: [
      { entity: 'Neon', attribute: 'free plan storage', value: '0.5 GB per project', sourceUrl: 'https://neon.com/pricing' },
      { entity: 'Supabase', attribute: 'free plan database size', value: '500 MB', sourceUrl: 'https://supabase.com/pricing' },
    ],
  },
  {
    when: { weekday: 'Tuesday' },
    hour: 15,
    user: 'Compare Postgres hosting for a production app: Neon, Supabase, and AWS RDS. Entry paid plans?',
    assistant:
      'Entry paid plans: Neon Launch from $19/month [1], Supabase Pro $25/month per org [2], ' +
      'and AWS RDS db.t4g.micro around $12/month plus storage [3].',
    claims: [
      { entity: 'Neon', attribute: 'entry paid plan price', value: '$19/month', sourceUrl: 'https://neon.com/pricing' },
      { entity: 'Supabase', attribute: 'pro plan price', value: '$25/month', sourceUrl: 'https://supabase.com/pricing' },
      { entity: 'AWS RDS', attribute: 'db.t4g.micro monthly price', value: '$12/month', sourceUrl: 'https://aws.amazon.com/rds/postgresql/pricing/' },
    ],
  },
  {
    when: { weekday: 'Monday' },
    hour: 11,
    user: 'We need a CRM for a 20-person sales team. Shortlist 5 options with pricing.',
    assistant:
      'Shortlist: HubSpot Sales Hub Starter $20/seat/month [1], Pipedrive Essential $14/seat/month [2], ' +
      'Zoho CRM Standard $14/user/month [3], Salesforce Starter Suite $25/user/month [4], Freshsales Growth $9/user/month [5].',
    claims: [
      { entity: 'HubSpot Sales Hub', attribute: 'starter price', value: '$20/seat/month', sourceUrl: 'https://www.hubspot.com/pricing/sales' },
      { entity: 'Pipedrive', attribute: 'essential plan price', value: '$14/seat/month', sourceUrl: 'https://www.pipedrive.com/en/pricing' },
      { entity: 'Zoho CRM', attribute: 'standard plan price', value: '$14/user/month', sourceUrl: 'https://www.zoho.com/crm/zohocrm-pricing.html' },
      { entity: 'Salesforce', attribute: 'starter suite price', value: '$25/user/month', sourceUrl: 'https://www.salesforce.com/pricing/' },
      { entity: 'Freshsales', attribute: 'growth plan price', value: '$9/user/month', sourceUrl: 'https://www.freshworks.com/crm/pricing/' },
    ],
    collection: {
      name: 'CRM shortlist',
      description: 'CRM tools for a 20-person sales team',
      members: ['HubSpot Sales Hub', 'Pipedrive', 'Zoho CRM', 'Salesforce', 'Freshsales'],
    },
  },
];
