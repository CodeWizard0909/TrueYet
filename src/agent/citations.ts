const OPEN = '【';
const CLOSE = '】';
const MAX_TAG = 32; // longer than this is not a citation; give up and pass it through
const NNBSP = ' '; // narrow no-break space

/**
 * Cleans model-specific formatting out of a streaming answer:
 * - gpt-oss cites as 【4】 or 【4†source】; these become [4]. Non-numeric tags
 *   like 【memory】 are dropped. An unfinished 【… is held until it closes.
 * - gpt-oss puts narrow no-break spaces inside numbers ("7 .0 .2"); they are
 *   removed before "." or "," and become normal spaces elsewhere ("8 July").
 */
export class CitationNormalizer {
  private pending = '';
  private heldSpace = false;

  push(chunk: string): string {
    return this.fixSpaces(this.citations(chunk), false);
  }

  flush(): string {
    const rest = this.pending;
    this.pending = '';
    return this.fixSpaces(rest, true);
  }

  private citations(chunk: string): string {
    this.pending += chunk;
    let out = '';
    while (true) {
      const open = this.pending.indexOf(OPEN);
      if (open === -1) {
        out += this.pending;
        this.pending = '';
        return out;
      }
      out += this.pending.slice(0, open);
      this.pending = this.pending.slice(open);
      const close = this.pending.indexOf(CLOSE);
      if (close === -1) {
        if (this.pending.length > MAX_TAG) {
          out += this.pending;
          this.pending = '';
        }
        return out; // wait for the rest of the tag
      }
      out += rewrite(this.pending.slice(1, close));
      this.pending = this.pending.slice(close + 1);
    }
  }

  /** Holds back a trailing narrow space: whether it survives depends on the next character. */
  private fixSpaces(text: string, final: boolean): string {
    let s = (this.heldSpace ? NNBSP : '') + text;
    this.heldSpace = false;
    if (!final && s.endsWith(NNBSP)) {
      this.heldSpace = true;
      s = s.slice(0, -1);
    }
    return s.replace(/ (?=[.,])/g, '').replace(/ /g, ' ');
  }
}

function rewrite(tag: string): string {
  const numbers = tag
    .split('†')[0]!
    .split(/[,\s]+/)
    .filter((part) => /^\d+$/.test(part));
  return numbers.map((n) => `[${n}]`).join('');
}
