/**
 * Tests for the dashboard controller.
 *
 * These drive a real ProcessManager with real child processes; only the
 * terminal itself is substituted, via a Screen that captures writes. The
 * render loop is stepped manually (renderIntervalMs: 0) so assertions are
 * deterministic.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { ProcessManager } from '../../src/process/manager.js';
import { Dashboard } from '../../src/ui/dashboard.js';
import type { Screen } from '../../src/ui/dashboard.js';
import type { ProcessItem } from '../../src/config/types.js';

const ALIVE = 'node -e "setInterval(()=>{},1000)"';

function item(name: string): ProcessItem {
  return { name, args: [], fullCmd: ALIVE };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeScreen implements Screen {
  columns = 80;
  rows = 24;
  chunks: string[] = [];
  private resizeHandlers: Array<() => void> = [];

  write(chunk: string): void {
    this.chunks.push(chunk);
  }

  onResize(cb: () => void): void {
    this.resizeHandlers.push(cb);
  }

  offResize(cb: () => void): void {
    this.resizeHandlers = this.resizeHandlers.filter(h => h !== cb);
  }

  emitResize(): void {
    for (const handler of this.resizeHandlers) handler();
  }

  get text(): string {
    return this.chunks.join('');
  }

  clear(): void {
    this.chunks = [];
  }
}

interface Harness {
  manager: ProcessManager;
  screen: FakeScreen;
  dashboard: Dashboard;
  quits: number;
}

let active: Harness | null = null;

function setup(names: string[], now = () => 1_700_000_000_000): Harness {
  const manager = new ProcessManager();
  const screen = new FakeScreen();
  const harness = { manager, screen, quits: 0 } as Harness;

  const dashboard = new Dashboard({
    manager,
    groupName: 'g',
    screen,
    now,
    renderIntervalMs: 0,
    onQuit: () => {
      harness.quits++;
    }
  });

  manager.spawnGroup('g', names.map(item), 'no');
  dashboard.start();

  harness.dashboard = dashboard;
  active = harness;
  return harness;
}

afterEach(async () => {
  if (active) {
    active.dashboard.stop();
    await active.manager.killAll();
    active = null;
  }
});

describe('Dashboard selection', () => {
  it('should start with the first item selected', () => {
    const { dashboard } = setup(['a', 'b', 'c']);

    assert.strictEqual(dashboard.selectedIndex, 0);
  });

  it('should move the selection down', async () => {
    const { dashboard } = setup(['a', 'b', 'c']);

    await dashboard.handleKey({ name: 'down' });

    assert.strictEqual(dashboard.selectedIndex, 1);
  });

  it('should move the selection up', async () => {
    const { dashboard } = setup(['a', 'b', 'c']);

    await dashboard.handleKey({ name: 'down' });
    await dashboard.handleKey({ name: 'up' });

    assert.strictEqual(dashboard.selectedIndex, 0);
  });

  it('should clamp the selection at the last item', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'down' });
    await dashboard.handleKey({ name: 'down' });
    await dashboard.handleKey({ name: 'down' });

    assert.strictEqual(dashboard.selectedIndex, 1);
  });

  it('should clamp the selection at the first item', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'up' });

    assert.strictEqual(dashboard.selectedIndex, 0);
  });

  it('should accept j and k as selection aliases', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'j' });
    assert.strictEqual(dashboard.selectedIndex, 1);

    await dashboard.handleKey({ name: 'k' });
    assert.strictEqual(dashboard.selectedIndex, 0);
  });
});

describe('Dashboard log filtering', () => {
  it('should have no filter by default', () => {
    const { dashboard } = setup(['a', 'b']);

    assert.strictEqual(dashboard.filterItem, null);
  });

  it('should filter to the selected item', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'down' });
    await dashboard.handleKey({ name: 'f' });

    assert.strictEqual(dashboard.filterItem, 'b');
  });

  it('should clear the filter when toggled again', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'f' });
    await dashboard.handleKey({ name: 'f' });

    assert.strictEqual(dashboard.filterItem, null);
  });

  it('should move the filter when toggled on a different item', async () => {
    const { dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 'f' });
    await dashboard.handleKey({ name: 'down' });
    await dashboard.handleKey({ name: 'f' });

    assert.strictEqual(dashboard.filterItem, 'b');
  });

  it('should write log lines from every item when unfiltered', () => {
    const { manager, screen, dashboard } = setup(['a', 'b']);
    screen.clear();

    manager.emit('process-log', 'g', 'a', 'from-a', false);
    manager.emit('process-log', 'g', 'b', 'from-b', false);
    dashboard.tick();

    assert.ok(screen.text.includes('from-a'));
    assert.ok(screen.text.includes('from-b'));
  });

  it('should suppress other items log lines while filtered', async () => {
    const { manager, screen, dashboard } = setup(['a', 'b']);
    await dashboard.handleKey({ name: 'f' });
    screen.clear();

    manager.emit('process-log', 'g', 'a', 'from-a', false);
    manager.emit('process-log', 'g', 'b', 'from-b', false);
    dashboard.tick();

    assert.ok(screen.text.includes('from-a'), 'filtered item still logs');
    assert.ok(!screen.text.includes('from-b'), 'other items are suppressed');
  });

  it('should prefix log lines with the item name', () => {
    const { manager, screen, dashboard } = setup(['a']);
    screen.clear();

    manager.emit('process-log', 'g', 'a', 'hello', false);
    dashboard.tick();

    assert.ok(screen.text.includes('[a] hello'));
  });

  it('should ignore log lines from other groups', () => {
    const { manager, screen, dashboard } = setup(['a']);
    screen.clear();

    manager.emit('process-log', 'other', 'x', 'not-mine', false);
    dashboard.tick();

    assert.ok(!screen.text.includes('not-mine'));
  });
});

describe('Dashboard item control', () => {
  it('should stop the selected item on s', { timeout: 10000 }, async () => {
    const { manager, dashboard } = setup(['a', 'b']);

    await dashboard.handleKey({ name: 's' });

    const items = manager.getGroupItems('g');
    assert.strictEqual(items.find(i => i.name === 'a')!.status, 'stopped');
    assert.strictEqual(items.find(i => i.name === 'b')!.status, 'running');
  });

  it('should start the selected item when it is stopped', { timeout: 10000 }, async () => {
    const { manager, dashboard } = setup(['a']);

    await dashboard.handleKey({ name: 's' });
    await dashboard.handleKey({ name: 's' });

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'running');
  });

  it('should restart the selected item on r', { timeout: 10000 }, async () => {
    const { manager, dashboard } = setup(['a']);
    const before = manager.getGroupItems('g')[0].pid;

    await dashboard.handleKey({ name: 'r' });

    const after = manager.getGroupItems('g')[0];
    assert.strictEqual(after.status, 'running');
    assert.notStrictEqual(after.pid, before);
  });

  it('should restart every item on shift-R', { timeout: 15000 }, async () => {
    const { manager, dashboard } = setup(['a', 'b']);
    const before = manager.getGroupItems('g').map(i => i.pid);

    await dashboard.handleKey({ name: 'r', shift: true });

    const after = manager.getGroupItems('g');
    assert.strictEqual(after.length, 2);
    for (const status of after) {
      assert.strictEqual(status.status, 'running');
      assert.ok(!before.includes(status.pid), 'every process handle was replaced');
    }
  });

  it('should survive control keys pressed on an empty group', async () => {
    const manager = new ProcessManager();
    const screen = new FakeScreen();
    const dashboard = new Dashboard({
      manager,
      groupName: 'empty',
      screen,
      renderIntervalMs: 0,
      onQuit: () => {}
    });
    dashboard.start();

    await dashboard.handleKey({ name: 's' });
    await dashboard.handleKey({ name: 'r' });
    await dashboard.handleKey({ name: 'down' });

    dashboard.stop();
    assert.strictEqual(dashboard.selectedIndex, 0);
  });
});

describe('Dashboard command view', () => {
  it('should not show commands by default', () => {
    const { dashboard } = setup(['a']);

    assert.strictEqual(dashboard.showCommand, false);
  });

  it('should toggle the command view on v', async () => {
    const { dashboard } = setup(['a']);

    await dashboard.handleKey({ name: 'v' });

    assert.strictEqual(dashboard.showCommand, true);
  });

  it('should toggle the command view back off', async () => {
    const { dashboard } = setup(['a']);

    await dashboard.handleKey({ name: 'v' });
    await dashboard.handleKey({ name: 'v' });

    assert.strictEqual(dashboard.showCommand, false);
  });

  it('should paint the selected item command when toggled on', async () => {
    const { screen, dashboard } = setup(['a']);
    screen.clear();

    await dashboard.handleKey({ name: 'v' });
    dashboard.tick();

    assert.ok(screen.text.includes(ALIVE), `command not painted: ${screen.text}`);
  });

  it('should follow the selection while toggled on', async () => {
    const { screen, dashboard } = setup(['a', 'b']);
    await dashboard.handleKey({ name: 'v' });
    dashboard.tick();
    screen.clear();

    await dashboard.handleKey({ name: 'down' });
    dashboard.tick();

    assert.notStrictEqual(screen.text, '', 'moving the selection repaints the command');
  });
});

describe('Dashboard disabled items', () => {
  it('should list a disabled item as stopped and start it on s', { timeout: 10000 }, async () => {
    const manager = new ProcessManager();
    const screen = new FakeScreen();
    const dashboard = new Dashboard({
      manager,
      groupName: 'g',
      screen,
      renderIntervalMs: 0,
      onQuit: () => {}
    });

    manager.spawnGroup('g', [item('on'), item('off')], 'no', ['off']);
    dashboard.start();

    try {
      dashboard.tick();
      assert.ok(screen.text.includes('off'), 'disabled item appears in the list');
      assert.strictEqual(manager.getGroupItems('g')[1].status, 'stopped');

      await dashboard.handleKey({ name: 'down' });
      await dashboard.handleKey({ name: 's' });

      assert.strictEqual(manager.getGroupItems('g')[1].status, 'running');
    } finally {
      dashboard.stop();
      await manager.killAll();
    }
  });
});

describe('Dashboard quit', () => {
  it('should quit on q', async () => {
    const harness = setup(['a']);

    await harness.dashboard.handleKey({ name: 'q' });

    assert.strictEqual(harness.quits, 1);
  });

  it('should quit on ctrl-c', async () => {
    const harness = setup(['a']);

    await harness.dashboard.handleKey({ name: 'c', ctrl: true });

    assert.strictEqual(harness.quits, 1);
  });

  it('should not quit on a plain c', async () => {
    const harness = setup(['a']);

    await harness.dashboard.handleKey({ name: 'c' });

    assert.strictEqual(harness.quits, 0);
  });
});

describe('Dashboard rendering', () => {
  it('should paint the footer on the first tick', () => {
    const { screen, dashboard } = setup(['a']);
    screen.clear();

    dashboard.tick();

    assert.ok(screen.text.includes('running'), 'footer shows item status');
  });

  it('should not repaint when nothing changed', () => {
    const { screen, dashboard } = setup(['a']);
    dashboard.tick();
    screen.clear();

    dashboard.tick();

    assert.strictEqual(screen.text, '', 'a clean tick writes nothing');
  });

  it('should repaint after the selection moves', async () => {
    const { screen, dashboard } = setup(['a', 'b']);
    dashboard.tick();
    screen.clear();

    await dashboard.handleKey({ name: 'down' });
    dashboard.tick();

    assert.notStrictEqual(screen.text, '');
  });

  it('should repaint when uptime advances', () => {
    // Shares an origin with the real startedAt the manager records on spawn,
    // so the rendered uptime actually moves when the clock does.
    let clock = Date.now();
    const { screen, dashboard } = setup(['a'], () => clock);
    dashboard.tick();
    screen.clear();

    clock += 5000;
    dashboard.tick();

    assert.notStrictEqual(screen.text, '', 'uptime changing marks the footer dirty');
  });

  it('should restore the cursor on stop', () => {
    const { screen, dashboard } = setup(['a']);
    dashboard.tick();
    screen.clear();

    dashboard.stop();

    assert.ok(screen.text.includes('\x1b[?25h'), 'cursor is shown again');
  });

  it('should hide the cursor on start', () => {
    const { screen } = setup(['a']);

    assert.ok(screen.text.includes('\x1b[?25l'), 'cursor is hidden while active');
  });

  it('should tolerate being stopped twice', () => {
    const { dashboard } = setup(['a']);

    dashboard.stop();
    dashboard.stop();
  });

  it('should repaint on resize', () => {
    const { screen, dashboard } = setup(['a']);
    dashboard.tick();
    screen.clear();

    screen.columns = 60;
    screen.emitResize();
    dashboard.tick();

    assert.notStrictEqual(screen.text, '');
  });

  it('should stop painting after stop', async () => {
    const { manager, screen, dashboard } = setup(['a']);
    dashboard.stop();
    screen.clear();

    manager.emit('process-log', 'g', 'a', 'after-stop', false);
    dashboard.tick();
    await wait(10);

    assert.strictEqual(screen.text, '');
  });
});
