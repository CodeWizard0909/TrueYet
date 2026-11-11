import { describe, expect, it } from 'vitest';
import { verdictFor } from './verdict.ts';

describe('verdictFor', () => {
  it('treats the same price written differently as unchanged', () => {
    expect(verdictFor('$20/seat/month', '$20 per seat per month')).toBe('unchanged');
    expect(verdictFor('USD 1,200 / year', '$1200/yr')).toBe('unchanged');
    expect(verdictFor('0.5 GB', '0.5GB')).toBe('unchanged');
  });

  it('flags a different number as changed', () => {
    expect(verdictFor('$20/seat/month', '$25/seat/month')).toBe('changed');
    expect(verdictFor('0.5 GB', '1 GB')).toBe('changed');
  });

  it('compares wording when there are no numbers', () => {
    expect(verdictFor('Free tier available', 'free tier available')).toBe('unchanged');
    expect(verdictFor('Free tier available', 'Free tier discontinued')).toBe('changed');
  });

  it('is unverified when no current value could be found', () => {
    expect(verdictFor('$20/seat/month', null)).toBe('unverified');
  });
});
