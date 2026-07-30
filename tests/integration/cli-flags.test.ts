/**
 * Tests for CLI flag extraction and dashboard activation rules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseFlags } from '../../src/cli/flags.js';
import { shouldUseDashboard, shouldUseColor } from '../../src/ui/activation.js';

describe('parseFlags', () => {
  it('should return the args untouched when there are no flags', () => {
    const { flags, rest } = parseFlags(['up', 'test1']);

    assert.deepStrictEqual(rest, ['up', 'test1']);
    assert.strictEqual(flags.verbose, false);
    assert.strictEqual(flags.noUi, false);
    assert.strictEqual(flags.ascii, false);
  });

  it('should extract --verbose', () => {
    const { flags, rest } = parseFlags(['groups', '--verbose']);

    assert.strictEqual(flags.verbose, true);
    assert.deepStrictEqual(rest, ['groups']);
  });

  it('should extract -v', () => {
    const { flags, rest } = parseFlags(['groups', '-v']);

    assert.strictEqual(flags.verbose, true);
    assert.deepStrictEqual(rest, ['groups']);
  });

  it('should extract --no-ui', () => {
    const { flags, rest } = parseFlags(['test1', '--no-ui']);

    assert.strictEqual(flags.noUi, true);
    assert.deepStrictEqual(rest, ['test1']);
  });

  it('should extract --ascii', () => {
    const { flags, rest } = parseFlags(['test1', '--ascii']);

    assert.strictEqual(flags.ascii, true);
    assert.deepStrictEqual(rest, ['test1']);
  });

  it('should extract several flags at once', () => {
    const { flags, rest } = parseFlags(['test1', '--no-ui', '--ascii']);

    assert.strictEqual(flags.noUi, true);
    assert.strictEqual(flags.ascii, true);
    assert.deepStrictEqual(rest, ['test1']);
  });

  it('should extract flags regardless of position', () => {
    const { flags, rest } = parseFlags(['--ascii', 'up', 'test1']);

    assert.strictEqual(flags.ascii, true);
    assert.deepStrictEqual(rest, ['up', 'test1']);
  });

  it('should preserve the order of the remaining args', () => {
    const { rest } = parseFlags(['up', '--ascii', 'test1']);

    assert.deepStrictEqual(rest, ['up', 'test1']);
  });

  it('should leave unknown flags in place', () => {
    const { rest } = parseFlags(['test1', '--unknown']);

    assert.deepStrictEqual(rest, ['test1', '--unknown']);
  });
});

describe('shouldUseDashboard', () => {
  const base = { isTTY: true, noUi: false, rows: 24 };

  it('should enable the dashboard on a normal TTY', () => {
    assert.strictEqual(shouldUseDashboard(base), true);
  });

  it('should disable the dashboard when stdout is not a TTY', () => {
    assert.strictEqual(shouldUseDashboard({ ...base, isTTY: false }), false);
  });

  it('should disable the dashboard when --no-ui is passed', () => {
    assert.strictEqual(shouldUseDashboard({ ...base, noUi: true }), false);
  });

  it('should disable the dashboard in a terminal too short to hold it', () => {
    assert.strictEqual(shouldUseDashboard({ ...base, rows: 7 }), false);
  });

  it('should enable the dashboard at the minimum usable height', () => {
    assert.strictEqual(shouldUseDashboard({ ...base, rows: 8 }), true);
  });
});

describe('shouldUseColor', () => {
  it('should use color on a TTY', () => {
    assert.strictEqual(shouldUseColor({ isTTY: true, noColor: false }), true);
  });

  it('should not use color when NO_COLOR is set', () => {
    assert.strictEqual(shouldUseColor({ isTTY: true, noColor: true }), false);
  });

  it('should not use color when not a TTY', () => {
    assert.strictEqual(shouldUseColor({ isTTY: false, noColor: false }), false);
  });
});
