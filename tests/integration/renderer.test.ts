/**
 * Tests for the dashboard renderer.
 *
 * The renderer is pure — (model, width, height) -> string[] — so these run
 * without a TTY and assert directly on the painted lines.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render, formatUptime } from '../../src/ui/renderer.js';
import type { RenderModel } from '../../src/ui/renderer.js';
import type { ItemStatus } from '../../src/process/manager.js';

const NOW = 1_700_000_000_000;

function status(overrides: Partial<ItemStatus> & { name: string }): ItemStatus {
  return {
    status: 'running',
    pid: 111,
    startedAt: NOW - 1000,
    restartCount: 0,
    lastExitCode: null,
    command: `run ${overrides.name}`,
    ...overrides
  };
}

function model(overrides: Partial<RenderModel> = {}): RenderModel {
  return {
    groupName: 'test1',
    items: [status({ name: 'api' })],
    selectedIndex: 0,
    filterItem: null,
    groupStartedAt: NOW - 1000,
    showCommand: false,
    now: NOW,
    ascii: false,
    color: false,
    ...overrides
  };
}

/** Item rows sit between the header and the hint line. */
function itemRows(lines: string[]): string[] {
  return lines.slice(2, -1);
}

describe('formatUptime', () => {
  it('should render sub-minute durations in seconds', () => {
    assert.strictEqual(formatUptime(45_000), '45s');
  });

  it('should render sub-hour durations as minutes and padded seconds', () => {
    assert.strictEqual(formatUptime(62_000), '1m02s');
  });

  it('should render long durations as hours and padded minutes', () => {
    assert.strictEqual(formatUptime(7_500_000), '2h05m');
  });

  it('should render zero as seconds', () => {
    assert.strictEqual(formatUptime(0), '0s');
  });
});

describe('render — structure', () => {
  it('should paint a separator, header, one row per item and a hint line', () => {
    const lines = render(
      model({ items: [status({ name: 'api' }), status({ name: 'worker' })] }),
      80,
      24
    );

    assert.strictEqual(lines.length, 5);
    assert.ok(lines[0].startsWith('─'), 'first line is the separator');
    assert.ok(lines[1].includes('test1'), 'header names the group');
    assert.ok(lines[4].includes('[q] quit'), 'last line is the hint');
  });

  it('should summarise status counts in the header', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'a' }),
          status({ name: 'b' }),
          status({ name: 'c', status: 'restarting' })
        ]
      }),
      80,
      24
    );

    assert.match(lines[1], /2 running/);
    assert.match(lines[1], /1 restarting/);
  });

  it('should omit statuses with no items from the header', () => {
    const lines = render(model(), 80, 24);

    assert.match(lines[1], /1 running/);
    assert.doesNotMatch(lines[1], /stopped/);
    assert.doesNotMatch(lines[1], /crashed/);
  });

  it('should show a single group uptime in the header', () => {
    const lines = render(model({ groupStartedAt: NOW - 62_000 }), 80, 24);

    assert.match(lines[1], /up 1m02s/);
  });

  it('should omit group uptime when the group has no start time', () => {
    const lines = render(model({ groupStartedAt: null }), 80, 24);

    assert.doesNotMatch(lines[1], /up /);
  });
});

describe('render — item rows', () => {
  it('should show the name and status of a running item', () => {
    const lines = render(
      model({ items: [status({ name: 'api', startedAt: NOW - 62_000 })] }),
      80,
      24
    );

    assert.match(itemRows(lines)[0], /api/);
    assert.match(itemRows(lines)[0], /running/);
  });

  // Uptime is a group-level figure in the header; per-item timers were noise.
  it('should not show a per-item uptime', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'api', startedAt: NOW - 62_000 }),
          status({ name: 'worker', startedAt: NOW - 5_000 })
        ]
      }),
      80,
      24
    );

    for (const row of itemRows(lines)) {
      assert.doesNotMatch(row, /\d+m\d+s/, `per-item uptime in: ${row}`);
      assert.doesNotMatch(row, /\d+s\b/, `per-item uptime in: ${row}`);
    }
  });

  it('should show restart count and exit code for a restarting item', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'worker', status: 'restarting', restartCount: 2, lastExitCode: 1, startedAt: null })
        ]
      }),
      80,
      24
    );

    assert.match(itemRows(lines)[0], /restarting/);
    assert.match(itemRows(lines)[0], /×2/);
    assert.match(itemRows(lines)[0], /exit 1/);
  });

  it('should not show uptime for a stopped item', () => {
    const lines = render(
      model({ items: [status({ name: 'mailer', status: 'stopped', startedAt: null })] }),
      80,
      24
    );

    assert.match(itemRows(lines)[0], /stopped/);
    assert.doesNotMatch(itemRows(lines)[0], /\d+s/);
  });

  it('should mark the selected item and only that item', () => {
    const lines = render(
      model({
        items: [status({ name: 'a' }), status({ name: 'b' }), status({ name: 'c' })],
        selectedIndex: 1
      }),
      80,
      24
    );

    const rows = itemRows(lines);
    assert.ok(!rows[0].startsWith('›'), 'unselected row has no marker');
    assert.ok(rows[1].startsWith('›'), 'selected row is marked');
    assert.ok(!rows[2].startsWith('›'), 'unselected row has no marker');
  });

  it('should align item names into a column', () => {
    const lines = render(
      model({ items: [status({ name: 'a' }), status({ name: 'much-longer-name' })] }),
      80,
      24
    );

    const rows = itemRows(lines);
    assert.strictEqual(rows[0].indexOf('running'), rows[1].indexOf('running'));
  });
});

describe('render — glyphs', () => {
  it('should use unicode glyphs by default', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'a' }),
          status({ name: 'b', status: 'restarting' }),
          status({ name: 'c', status: 'stopped' }),
          status({ name: 'd', status: 'crashed' })
        ]
      }),
      80,
      24
    );

    const rows = itemRows(lines);
    assert.ok(rows[0].includes('●'));
    assert.ok(rows[1].includes('↻'));
    assert.ok(rows[2].includes('○'));
    assert.ok(rows[3].includes('✕'));
  });

  it('should use ascii glyphs when asked', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'a' }),
          status({ name: 'b', status: 'restarting' }),
          status({ name: 'c', status: 'stopped' }),
          status({ name: 'd', status: 'crashed' })
        ],
        ascii: true
      }),
      80,
      24
    );

    const rows = itemRows(lines);
    assert.ok(rows[0].includes('[*]'));
    assert.ok(rows[1].includes('[~]'));
    assert.ok(rows[2].includes('[ ]'));
    assert.ok(rows[3].includes('[x]'));
  });

  it('should emit no unicode anywhere in ascii mode', () => {
    const lines = render(
      model({
        items: [status({ name: 'a' }), status({ name: 'b', status: 'crashed' })],
        ascii: true,
        selectedIndex: 1
      }),
      80,
      24
    );

    for (const line of lines) {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(line, /[^\x00-\x7F]/, `non-ascii in: ${line}`);
    }
  });
});

describe('render — color', () => {
  it('should emit no escape sequences when color is off', () => {
    const lines = render(model({ color: false }), 80, 24);

    for (const line of lines) {
      assert.ok(!line.includes('\x1b['), `unexpected SGR in: ${JSON.stringify(line)}`);
    }
  });

  it('should emit escape sequences when color is on', () => {
    const lines = render(model({ color: true }), 80, 24);

    assert.ok(lines.some(l => l.includes('\x1b[')), 'expected at least one SGR sequence');
  });

  it('should reset color at the end of every colored line', () => {
    const lines = render(model({ color: true }), 80, 24);

    for (const line of lines) {
      if (line.includes('\x1b[')) {
        assert.ok(line.endsWith('\x1b[0m'), `line does not reset: ${JSON.stringify(line)}`);
      }
    }
  });
});

describe('render — truncation', () => {
  it('should keep every line inside the terminal width', () => {
    const lines = render(
      model({
        items: [
          status({ name: 'an-extremely-long-item-name-that-will-not-fit', startedAt: NOW - 62_000 })
        ]
      }),
      40,
      24
    );

    for (const line of lines) {
      assert.ok(line.length <= 39, `line of ${line.length} exceeds width-1: ${JSON.stringify(line)}`);
    }
  });

  it('should keep lines inside very narrow terminals', () => {
    const lines = render(model(), 20, 24);

    for (const line of lines) {
      assert.ok(line.length <= 19, `line of ${line.length} too wide: ${JSON.stringify(line)}`);
    }
  });

  it('should measure width excluding escape sequences', () => {
    const lines = render(model({ color: true }), 40, 24);

    for (const line of lines) {
      const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
      assert.ok(visible.length <= 39, `visible width ${visible.length} exceeds width-1`);
    }
  });
});

describe('render — windowing', () => {
  const many = Array.from({ length: 10 }, (_, i) => status({ name: `item${i}` }));

  it('should show every item when they all fit', () => {
    const lines = render(model({ items: many }), 80, 24);

    assert.strictEqual(itemRows(lines).length, 10);
  });

  it('should cap item rows to the available height', () => {
    // height 10 leaves 4 rows for items
    const lines = render(model({ items: many }), 80, 10);

    assert.strictEqual(itemRows(lines).length, 4);
  });

  it('should mark hidden items below when the selection is at the top', () => {
    const lines = render(model({ items: many, selectedIndex: 0 }), 80, 10);
    const rows = itemRows(lines);

    assert.match(rows[rows.length - 1], /↓ 6 more/);
    assert.doesNotMatch(rows[0], /↑/);
  });

  it('should mark hidden items above when the selection is at the bottom', () => {
    const lines = render(model({ items: many, selectedIndex: 9 }), 80, 10);
    const rows = itemRows(lines);

    assert.match(rows[0], /↑ 6 more/);
    assert.doesNotMatch(rows[rows.length - 1], /↓/);
  });

  it('should keep the selected item visible when scrolled into the middle', () => {
    const lines = render(model({ items: many, selectedIndex: 5 }), 80, 10);
    const rows = itemRows(lines);

    assert.ok(rows.some(r => r.startsWith('›') && r.includes('item5')), 'selection is visible');
  });

  it('should use ascii markers for hidden items in ascii mode', () => {
    const lines = render(model({ items: many, selectedIndex: 0, ascii: true }), 80, 10);
    const rows = itemRows(lines);

    assert.match(rows[rows.length - 1], /v 6 more/);
  });

  it('should always show at least one item row', () => {
    const lines = render(model({ items: many }), 80, 4);

    assert.ok(itemRows(lines).length >= 1);
  });
});

describe('render — command line', () => {
  /** The command line sits directly above the hint line. */
  const commandLine = (lines: string[]) => lines[lines.length - 2];

  it('should not show a command line by default', () => {
    const lines = render(model(), 80, 24);

    assert.doesNotMatch(commandLine(lines), /run api/);
  });

  it('should show the selected item command when enabled', () => {
    const lines = render(model({ showCommand: true }), 80, 24);

    assert.match(commandLine(lines), /run api/);
  });

  it('should add exactly one line when enabled', () => {
    const off = render(model({ showCommand: false }), 80, 24);
    const on = render(model({ showCommand: true }), 80, 24);

    assert.strictEqual(on.length, off.length + 1);
  });

  it('should follow the selection', () => {
    const lines = render(
      model({
        items: [status({ name: 'api' }), status({ name: 'worker' })],
        selectedIndex: 1,
        showCommand: true
      }),
      80,
      24
    );

    assert.match(commandLine(lines), /run worker/);
    assert.doesNotMatch(commandLine(lines), /run api/);
  });

  it('should keep the hint line last', () => {
    const lines = render(model({ showCommand: true }), 80, 24);

    assert.match(lines[lines.length - 1], /\[q\] quit/);
  });

  it('should keep the command line inside the terminal width', () => {
    const lines = render(
      model({
        items: [status({ name: 'api', command: 'node -e "'.padEnd(200, 'x') })],
        showCommand: true
      }),
      50,
      24
    );

    for (const line of lines) {
      assert.ok(line.length <= 49, `line of ${line.length} exceeds width-1`);
    }
  });

  it('should give up a row to the command line when height is tight', () => {
    const many = Array.from({ length: 10 }, (_, i) => status({ name: `item${i}` }));

    const off = render(model({ items: many, showCommand: false }), 80, 12);
    const on = render(model({ items: many, showCommand: true }), 80, 12);

    assert.strictEqual(on.length, off.length, 'total footer height is unchanged');
  });

  it('should emit no unicode in ascii mode', () => {
    const lines = render(model({ showCommand: true, ascii: true }), 80, 24);

    for (const line of lines) {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(line, /[^\x00-\x7F]/, `non-ascii in: ${line}`);
    }
  });

  it('should show nothing when the group has no items', () => {
    const lines = render(model({ items: [], showCommand: true }), 80, 24);

    assert.match(lines[lines.length - 1], /\[q\] quit/);
  });

  it('should advertise the key in the hint line', () => {
    const lines = render(model(), 80, 24);

    assert.match(lines[lines.length - 1], /\[v\]/);
  });
});

describe('render — filter', () => {
  it('should show the active filter in the header', () => {
    const lines = render(model({ filterItem: 'api' }), 80, 24);

    assert.match(lines[1], /filter: api/);
  });

  it('should not mention filtering when inactive', () => {
    const lines = render(model({ filterItem: null }), 80, 24);

    assert.doesNotMatch(lines[1], /filter/);
  });
});
