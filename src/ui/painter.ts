const CLEAR_LINE = '\x1b[K';
const CLEAR_BELOW = '\x1b[0J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * Owns the pinned footer's escape sequences and the count of lines it last
 * painted. Every write to the terminal goes through here so the footer is
 * always repainted below whatever else was written.
 *
 * Repaints overwrite the previous block in a single pass rather than clearing
 * it first. Clearing before rewriting leaves a frame in which the footer is
 * blank, which at repaint rates reads as a blink; overwriting each line and
 * clearing only what falls below the new content never shows an empty block.
 */
export class Painter {
  private painted = 0;

  constructor(private readonly write: (chunk: string) => void) {}

  get paintedLines(): number {
    return this.painted;
  }

  paint(lines: string[]): void {
    this.flush([], lines);
  }

  /** Writes queued log lines above the footer, then repaints the footer. */
  flush(logLines: string[], footerLines: string[]): void {
    if (logLines.length === 0 && footerLines.length === 0) {
      this.erase();
      return;
    }

    const parts: string[] = [];

    // Return to the top of the previously painted block. Painting leaves the
    // cursor on its last line, so the distance is one less than the count.
    if (this.painted > 0) {
      parts.push('\r');
      if (this.painted > 1) {
        parts.push(`\x1b[${this.painted - 1}A`);
      }
    }

    // Each row clears to end of line as it is written, so leftovers from a
    // longer previous row cannot show through.
    parts.push([...logLines, ...footerLines].map(line => `${line}${CLEAR_LINE}`).join('\n'));

    // Clears rows the block no longer occupies, e.g. after it shrinks.
    parts.push(CLEAR_BELOW);

    // With no footer to land on, the log still needs to end its row.
    if (footerLines.length === 0) {
      parts.push('\n');
    }

    this.write(parts.join(''));
    this.painted = footerLines.length;
  }

  erase(): void {
    if (this.painted === 0) {
      return;
    }

    const up = this.painted > 1 ? `\x1b[${this.painted - 1}A` : '';
    this.write(`\r${up}${CLEAR_BELOW}`);
    this.painted = 0;
  }

  hideCursor(): void {
    this.write(HIDE_CURSOR);
  }

  showCursor(): void {
    this.write(SHOW_CURSOR);
  }

  /** Drops the painted block without emitting escapes, for use after a resize. */
  reset(): void {
    this.painted = 0;
  }
}
