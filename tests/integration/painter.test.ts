/**
 * Tests for the footer painter.
 *
 * The painter owns the repaint escape sequences and the painted-line count.
 * If that count drifts, the footer walks up the screen and eats the log
 * scrollback, so the sequences are asserted exactly.
 *
 * The other property under test is flicker: the painter must overwrite its
 * block in a single pass. Clearing the block before rewriting it leaves a
 * frame where the footer is blank, which reads as a blink at repaint rates.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Painter } from '../../src/ui/painter.js';

const CLEAR_LINE = '\x1b[K';
const CLEAR_BELOW = '\x1b[0J';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

describe('Painter', () => {
  let written: string[];
  let painter: Painter;

  beforeEach(() => {
    written = [];
    painter = new Painter(chunk => written.push(chunk));
  });

  const output = () => written.join('');

  it('should write the lines in order', () => {
    painter.paint(['one', 'two', 'three']);

    const visible = output().replace(/\x1b\[[0-9]*[A-Za-z]/g, '');
    assert.strictEqual(visible, 'one\ntwo\nthree');
  });

  it('should not move the cursor up on the first paint', () => {
    painter.paint(['one', 'two']);

    assert.doesNotMatch(output(), /\x1b\[\d+A/);
  });

  it('should track how many lines it painted', () => {
    painter.paint(['one', 'two', 'three']);

    assert.strictEqual(painter.paintedLines, 3);
  });

  it('should move up over the previous block before repainting', () => {
    painter.paint(['a', 'b', 'c']);
    written.length = 0;

    painter.paint(['d', 'e', 'f']);

    // Three painted lines leaves the cursor on the last one: move up two.
    assert.ok(output().startsWith('\r\x1b[2A'), `got: ${JSON.stringify(output())}`);
  });

  it('should not move up when only one line was painted', () => {
    painter.paint(['only']);
    written.length = 0;

    painter.paint(['next']);

    assert.ok(output().startsWith('\r'), `got: ${JSON.stringify(output())}`);
    assert.doesNotMatch(output(), /\x1b\[\d+A/);
  });

  it('should adjust the move-up distance when the block shrinks', () => {
    painter.paint(['a', 'b', 'c', 'd']);
    written.length = 0;

    painter.paint(['x']);

    assert.ok(output().startsWith('\r\x1b[3A'), `got: ${JSON.stringify(output())}`);
    assert.strictEqual(painter.paintedLines, 1);
  });

  describe('flicker', () => {
    it('should not clear the block before rewriting it', () => {
      painter.paint(['a', 'b', 'c']);
      written.length = 0;

      painter.paint(['d', 'e', 'f']);

      // A clear that lands before any content blanks the footer for a frame.
      const out = output();
      const firstClearBelow = out.indexOf(CLEAR_BELOW);
      assert.ok(
        firstClearBelow === -1 || firstClearBelow > out.indexOf('d'),
        `screen cleared before content was written: ${JSON.stringify(out)}`
      );
    });

    it('should clear each line as it overwrites it', () => {
      painter.paint(['a', 'b']);
      written.length = 0;

      painter.paint(['x', 'y']);

      assert.ok(output().includes(`x${CLEAR_LINE}`), 'stale text past the new line must be cleared');
      assert.ok(output().includes(`y${CLEAR_LINE}`));
    });

    it('should clear leftover rows below when the block shrinks', () => {
      painter.paint(['a', 'b', 'c', 'd']);
      written.length = 0;

      painter.paint(['x']);

      assert.ok(output().endsWith(CLEAR_BELOW), 'rows below the shorter block must be cleared');
    });

    it('should repaint in a single write', () => {
      painter.paint(['a', 'b']);
      written.length = 0;

      painter.paint(['x', 'y']);

      // Multiple writes let the terminal present a partial frame.
      assert.strictEqual(written.length, 1, `expected one write, got ${written.length}`);
    });
  });

  it('should reset the painted count after erasing', () => {
    painter.paint(['a', 'b']);
    painter.erase();

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

  it('should place log output above a repainted footer', () => {
    painter.paint(['footer']);
    written.length = 0;

    painter.flush(['log line'], ['footer']);

    const out = output();
    assert.ok(out.indexOf('log line') < out.indexOf('footer'), 'log is written above the footer');
    assert.ok(out.startsWith('\r'), 'repaint starts at the top of the old block');
  });

  it('should write every queued log line above the footer', () => {
    painter.paint(['footer']);
    written.length = 0;

    painter.flush(['first', 'second'], ['footer']);

    const visible = output().replace(/\x1b\[[0-9]*[A-Za-z]/g, '').replace(/^\r/, '');
    assert.strictEqual(visible, 'first\nsecond\nfooter');
  });

  it('should count only the footer lines as painted', () => {
    painter.paint(['footer']);

    painter.flush(['a', 'b', 'c'], ['footer']);

    assert.strictEqual(painter.paintedLines, 1, 'log lines scroll away, they are not repainted');
  });

  it('should terminate log lines when there is no footer to follow them', () => {
    painter.flush(['orphan'], []);

    assert.ok(output().includes('orphan'));
    assert.ok(output().endsWith('\n'), 'a log line with no footer must still end its row');
    assert.strictEqual(painter.paintedLines, 0);
  });

  it('should repaint the footer even with no queued logs', () => {
    painter.paint(['old']);
    written.length = 0;

    painter.flush([], ['new']);

    assert.ok(output().includes('new'));
    assert.strictEqual(painter.paintedLines, 1);
  });

  it('should hide and show the cursor', () => {
    painter.hideCursor();
    painter.showCursor();

    assert.ok(output().includes(HIDE_CURSOR));
    assert.ok(output().includes(SHOW_CURSOR));
  });

  it('should forget its painted block on reset without emitting escapes', () => {
    painter.paint(['a', 'b', 'c']);
    written.length = 0;

    painter.reset();

    assert.strictEqual(output(), '');
    assert.strictEqual(painter.paintedLines, 0);
  });
});
