/**
 * Tests for the footer painter.
 *
 * The painter's contract is what the terminal ends up showing: a repaint must
 * replace the previous block rather than land below it, and queued log lines
 * must stay above the footer. Asserting the escape sequences instead would
 * only pin down log-update's internals, so the writes are replayed through a
 * small terminal and the resulting screen is asserted.
 *
 * The other property under test is flicker: a repaint must not rewrite rows
 * that did not change, or the footer blinks at repaint rates.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Painter } from '../../src/ui/painter.js';
import type { Screen } from '../../src/ui/dashboard.js';

const CSI = /^\x1b\[([0-9;?]*)([A-Za-z])/;

/** Enough of a terminal to replay what the painter and log-update emit. */
class FakeTerminal implements Screen {
  columns = 80;
  rows = 24;
  cursorHidden = false;

  private lines: string[] = [''];
  private row = 0;
  private col = 0;

  write(chunk: string): void {
    let rest = chunk;

    while (rest.length > 0) {
      const control = CSI.exec(rest);
      if (control) {
        this.control(control[1], control[2]);
        rest = rest.slice(control[0].length);
        continue;
      }

      const next = rest[0];
      if (next === '\r') {
        this.col = 0;
        rest = rest.slice(1);
        continue;
      }

      if (next === '\n') {
        this.row++;
        this.col = 0;
        this.reserve();
        rest = rest.slice(1);
        continue;
      }

      const end = rest.search(/[\x1b\r\n]/);
      const text = end === -1 ? rest : rest.slice(0, end);
      this.put(text);
      rest = rest.slice(text.length);
    }
  }

  /** The visible screen, trailing blank rows dropped. */
  get screen(): string[] {
    const rows = this.lines.map(line => line.replace(/\s+$/, ''));
    while (rows.length > 0 && rows[rows.length - 1] === '') {
      rows.pop();
    }
    return rows;
  }

  onResize(): void {}
  offResize(): void {}

  private control(params: string, final: string): void {
    // Cursor visibility and synchronized output change nothing on screen.
    if (params.startsWith('?')) {
      if (final === 'l' && params === '?25') this.cursorHidden = true;
      if (final === 'h' && params === '?25') this.cursorHidden = false;
      return;
    }

    const value = params === '' ? null : Number(params);

    switch (final) {
      case 'A':
        this.row = Math.max(0, this.row - (value ?? 1));
        break;
      case 'B':
        this.row += value ?? 1;
        this.reserve();
        break;
      case 'G':
        this.col = (value ?? 1) - 1;
        break;
      case 'K':
        this.eraseInLine(value ?? 0);
        break;
      case 'J':
        this.eraseBelow(value ?? 0);
        break;
      default:
    }
  }

  private reserve(): void {
    while (this.lines.length <= this.row) {
      this.lines.push('');
    }
  }

  private put(text: string): void {
    this.reserve();
    const line = this.lines[this.row].padEnd(this.col, ' ');
    this.lines[this.row] = line.slice(0, this.col) + text + line.slice(this.col + text.length);
    this.col += text.length;
  }

  private eraseInLine(mode: number): void {
    this.reserve();
    this.lines[this.row] = mode === 2 ? '' : this.lines[this.row].slice(0, this.col);
  }

  private eraseBelow(mode: number): void {
    if (mode !== 0) return;
    this.reserve();
    this.lines[this.row] = this.lines[this.row].slice(0, this.col);
    this.lines.length = this.row + 1;
  }
}

describe('Painter', () => {
  let terminal: FakeTerminal;
  let painter: Painter;
  let written: string[];

  beforeEach(() => {
    terminal = new FakeTerminal();
    written = [];
    const record = terminal.write.bind(terminal);
    terminal.write = (chunk: string) => {
      written.push(chunk);
      record(chunk);
    };
    painter = new Painter(terminal);
  });

  const output = () => written.join('');

  it('should write the lines in order', () => {
    painter.paint(['one', 'two', 'three']);

    assert.deepStrictEqual(terminal.screen, ['one', 'two', 'three']);
  });

  it('should track how many lines it painted', () => {
    painter.paint(['one', 'two', 'three']);

    assert.strictEqual(painter.paintedLines, 3);
  });

  it('should replace the previous block instead of painting below it', () => {
    painter.paint(['a', 'b', 'c']);
    painter.paint(['d', 'e', 'f']);

    assert.deepStrictEqual(terminal.screen, ['d', 'e', 'f']);
  });

  it('should keep replacing the block over many repaints', () => {
    for (let cycle = 0; cycle < 12; cycle++) {
      painter.paint(['header', `cycle ${cycle}`, 'hint']);
    }

    assert.deepStrictEqual(terminal.screen, ['header', 'cycle 11', 'hint']);
  });

  it('should clear the rows a shrinking block no longer occupies', () => {
    painter.paint(['a', 'b', 'c', 'd']);
    painter.paint(['x']);

    assert.deepStrictEqual(terminal.screen, ['x']);
    assert.strictEqual(painter.paintedLines, 1);
  });

  it('should clear stale text past the end of a shorter row', () => {
    painter.paint(['a long row of text']);
    painter.paint(['short']);

    assert.deepStrictEqual(terminal.screen, ['short']);
  });

  describe('flicker', () => {
    it('should not rewrite rows that did not change', () => {
      painter.paint(['steady', 'changing', 'steady too']);
      written.length = 0;

      painter.paint(['steady', 'changed', 'steady too']);

      assert.ok(!output().includes('steady'), `unchanged rows were rewritten: ${JSON.stringify(output())}`);
      assert.ok(output().includes('changed'));
    });

    it('should repaint in a single write', () => {
      painter.paint(['a', 'b']);
      written.length = 0;

      painter.paint(['x', 'y']);

      // Multiple writes let the terminal present a partial frame.
      assert.strictEqual(written.length, 1, `expected one write, got ${written.length}`);
    });
  });

  it('should place log output above a repainted footer', () => {
    painter.paint(['footer']);

    painter.flush(['log line'], ['footer']);

    assert.deepStrictEqual(terminal.screen, ['log line', 'footer']);
  });

  it('should write every queued log line above the footer', () => {
    painter.paint(['footer']);

    painter.flush(['first', 'second'], ['footer']);

    assert.deepStrictEqual(terminal.screen, ['first', 'second', 'footer']);
  });

  it('should leave earlier log lines in place as the footer moves down', () => {
    painter.paint(['footer']);

    painter.flush(['first'], ['footer']);
    painter.flush(['second'], ['footer']);

    assert.deepStrictEqual(terminal.screen, ['first', 'second', 'footer']);
  });

  it('should count only the footer lines as painted', () => {
    painter.paint(['footer']);

    painter.flush(['a', 'b', 'c'], ['footer']);

    assert.strictEqual(painter.paintedLines, 1, 'log lines scroll away, they are not repainted');
  });

  it('should keep log lines when there is no footer to follow them', () => {
    painter.flush(['orphan'], []);

    assert.deepStrictEqual(terminal.screen, ['orphan']);
    assert.strictEqual(painter.paintedLines, 0);
  });

  it('should repaint the footer even with no queued logs', () => {
    painter.paint(['old']);

    painter.flush([], ['new']);

    assert.deepStrictEqual(terminal.screen, ['new']);
    assert.strictEqual(painter.paintedLines, 1);
  });

  it('should erase the painted block', () => {
    painter.paint(['a', 'b']);

    painter.erase();

    assert.deepStrictEqual(terminal.screen, []);
    assert.strictEqual(painter.paintedLines, 0);
  });

  it('should write nothing when erasing with no painted block', () => {
    painter.erase();

    assert.strictEqual(output(), '');
  });

  it('should write nothing when erasing twice', () => {
    painter.paint(['a', 'b']);
    painter.erase();
    written.length = 0;

    painter.erase();

    assert.strictEqual(output(), '');
  });

  it('should hide and show the cursor', () => {
    painter.hideCursor();
    assert.strictEqual(terminal.cursorHidden, true);

    painter.showCursor();
    assert.strictEqual(terminal.cursorHidden, false);
  });

  it('should forget its painted block on reset without emitting escapes', () => {
    painter.paint(['a', 'b', 'c']);
    written.length = 0;

    painter.reset();

    assert.strictEqual(output(), '');
    assert.strictEqual(painter.paintedLines, 0);
  });

  it('should paint a fresh block after a reset', () => {
    painter.paint(['a', 'b']);
    painter.reset();

    painter.paint(['c', 'd']);

    // A resize reflows the old block, so the new one is painted where the
    // cursor stands rather than over rows the painter can no longer trust.
    assert.ok(terminal.screen.includes('c'));
    assert.ok(terminal.screen.includes('d'));
  });
});
