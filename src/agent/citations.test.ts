import { describe, expect, it } from 'vitest';
import { CitationNormalizer } from './citations.ts';

const run = (chunks: string[]) => {
  const n = new CitationNormalizer();
  return chunks.map((c) => n.push(c)).join('') + n.flush();
};

describe('CitationNormalizer', () => {
  it('turns lenticular citations into [n]', () => {
    expect(run(['Node 26 is LTS【1】. Neon grew【4†source】.'])).toBe('Node 26 is LTS[1]. Neon grew[4].');
  });

  it('splits multi-citations and drops non-numeric tags', () => {
    expect(run(['See【1, 3】 and earlier notes【memory】.'])).toBe('See[1][3] and earlier notes.');
  });

  it('handles a citation split across streamed chunks', () => {
    expect(run(['Changed【', '4', '】 today'])).toBe('Changed[4] today');
  });

  it('leaves ordinary text and [n] citations alone', () => {
    expect(run(['Price is $19 [2]', ' per month.'])).toBe('Price is $19 [2] per month.');
  });

  it('removes the narrow no-break spaces gpt-oss puts inside version numbers, even across chunks', () => {
    expect(run(['TypeScript is **7', ' ', '.', '0', ' ', '.2**'])).toBe('TypeScript is **7.0.2**');
    expect(run(['released on 8 July 2026'])).toBe('released on 8 July 2026');
  });

  it('flushes an unclosed bracket as-is rather than losing text', () => {
    expect(run(['odd 【 bracket'])).toBe('odd 【 bracket');
  });
});
