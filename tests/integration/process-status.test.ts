/**
 * Integration tests for ProcessManager status tracking and per-item control.
 *
 * Covers the status state machine (running/restarting/stopped/crashed),
 * the per-item control API, and the events the terminal UI consumes.
 *
 * These tests spawn real node processes so the status transitions are driven
 * by genuine process lifecycle events rather than simulated ones.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { ProcessManager } from '../../src/process/manager.js';
import type { ProcessItem } from '../../src/config/types.js';

const ALIVE = 'node -e "setInterval(()=>{},1000)"';
const EXITS_NOW = 'node -e "process.exit(0)"';

function item(name: string, fullCmd: string): ProcessItem {
  return { name, args: [], fullCmd };
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ProcessManager status tracking', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  it('should report a spawned item as running', async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('alive', ALIVE)], 'no');

    const items = manager.getGroupItems('g');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'alive');
    assert.strictEqual(items[0].status, 'running');
    assert.ok(items[0].pid !== null, 'pid should be set');
    assert.ok(items[0].startedAt !== null, 'startedAt should be set');
  });

  it('should report an item as stopped after it exits under restart=no', async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('quick', EXITS_NOW)], 'no');

    await wait(600);

    const items = manager.getGroupItems('g');
    assert.strictEqual(items[0].status, 'stopped');
    assert.strictEqual(items[0].lastExitCode, 0);
  });

  it('should report an item as restarting between exit and respawn', { timeout: 5000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('flappy', EXITS_NOW)], 'yes');

    // The restart delay is 1s; sample partway through it.
    await wait(500);

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'restarting');
  });

  it('should return to running after a restart completes', { timeout: 5000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('flappy', EXITS_NOW)], 'yes');

    await new Promise<void>(resolve => manager.once('item-restarted', () => resolve()));

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'running');
  });

  it('should report an item as crashed once the crash loop trips', { timeout: 15000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('crasher', EXITS_NOW)], 'yes');

    await new Promise<void>(resolve => manager.once('item-crash-looped', () => resolve()));

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'crashed');
  });

  it('should return an empty array for an unknown group', () => {
    manager = new ProcessManager();
    assert.deepStrictEqual(manager.getGroupItems('nope'), []);
  });

  it('should record when the group started', () => {
    manager = new ProcessManager();
    const before = Date.now();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    const startedAt = manager.getGroupStartedAt('g');

    assert.ok(startedAt !== null);
    assert.ok(startedAt! >= before && startedAt! <= Date.now());
  });

  it('should keep the group start time across an item restart', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');
    const startedAt = manager.getGroupStartedAt('g');

    await manager.restartItem('g', 'a');

    assert.strictEqual(
      manager.getGroupStartedAt('g'),
      startedAt,
      'restarting an item does not restart the group'
    );
  });

  it('should report no start time for an unknown group', () => {
    manager = new ProcessManager();
    assert.strictEqual(manager.getGroupStartedAt('nope'), null);
  });

  it('should expose the command each item runs', () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    assert.strictEqual(manager.getGroupItems('g')[0].command, ALIVE);
  });

  it('should expose the command of a never-started disabled item', () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('off', ALIVE)], 'no', ['off']);

    assert.strictEqual(manager.getGroupItems('g')[0].command, ALIVE);
  });
});

describe('ProcessManager per-item control', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  it('should stop a single item without touching its siblings', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE), item('b', ALIVE)], 'no');

    await manager.stopItem('g', 'a');

    const items = manager.getGroupItems('g');
    assert.strictEqual(items.find(i => i.name === 'a')!.status, 'stopped');
    assert.strictEqual(items.find(i => i.name === 'b')!.status, 'running');
  });

  it('should keep a manually stopped item down under restart=yes', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'yes');

    await manager.stopItem('g', 'a');
    // Well past the 1s restart delay it would use if the policy applied.
    await wait(2500);

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'stopped');
  });

  it('should bring a stopped item back with startItem', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    await manager.stopItem('g', 'a');
    await manager.startItem('g', 'a');

    const status = manager.getGroupItems('g')[0];
    assert.strictEqual(status.status, 'running');
    assert.ok(status.pid !== null);
  });

  it('should replace the process handle when restarting a single item', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');
    const originalPid = manager.getGroupItems('g')[0].pid;

    await manager.restartItem('g', 'a');

    const status = manager.getGroupItems('g')[0];
    assert.strictEqual(status.status, 'running');
    assert.notStrictEqual(status.pid, originalPid);
  });

  it('should clear the crash window when restarting a crashed item', { timeout: 20000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('crasher', EXITS_NOW)], 'yes');

    await new Promise<void>(resolve => manager.once('item-crash-looped', () => resolve()));
    assert.strictEqual(manager.getGroupItems('g')[0].status, 'crashed');

    await manager.restartItem('g', 'crasher');

    // A cleared window means the restart policy gets a fresh set of attempts,
    // so the item restarts rather than immediately reporting crashed again.
    assert.strictEqual(manager.getGroupItems('g')[0].restartCount, 0);
  });

  // A restart is scheduled 1s after an exit. Stopping and restarting the item
  // inside that window must cancel the pending respawn, or it fires later and
  // spawns a second process on top of the live one.
  it('should cancel a pending restart when the item is stopped and started', { timeout: 15000 }, async () => {
    manager = new ProcessManager();
    // A long-lived command, killed from outside, so the only thing that could
    // respawn it after startItem is a leftover timer.
    manager.spawnGroup('g', [item('flappy', ALIVE)], 'yes');

    const originalPid = manager.getGroupItems('g')[0].pid!;
    const restarting = new Promise<void>(resolve => manager.once('item-restarting', () => resolve()));
    process.kill(originalPid);
    await restarting;

    await manager.stopItem('g', 'flappy');
    manager.startItem('g', 'flappy');
    const pidAfterStart = manager.getGroupItems('g')[0].pid;

    // Well past the pending restart's deadline.
    await wait(2000);

    assert.strictEqual(
      manager.getGroupItems('g')[0].pid,
      pidAfterStart,
      'a stale restart timer replaced the running process'
    );
  });

  it('should treat stopping an already stopped item as a no-op', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    await manager.stopItem('g', 'a');
    await manager.stopItem('g', 'a');

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'stopped');
  });

  it('should reject control calls for an unknown item', async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    await assert.rejects(() => manager.stopItem('g', 'ghost'), /ghost/);
  });
});

describe('ProcessManager shutdown progress', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  it('should report each item as it is killed', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE), item('b', ALIVE)], 'no');

    const killed: string[] = [];
    manager.on('item-killed', (_g: string, name: string) => killed.push(name));

    await manager.killGroup('g');

    assert.deepStrictEqual(killed.sort(), ['a', 'b']);
  });

  it('should report never-started disabled items as killed too', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('on', ALIVE), item('off', ALIVE)], 'no', ['off']);

    const killed: string[] = [];
    manager.on('item-killed', (_g: string, name: string) => killed.push(name));

    await manager.killGroup('g');

    assert.deepStrictEqual(killed.sort(), ['off', 'on'], 'progress must account for every listed item');
  });

  it('should report every item before reporting the group stopped', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE), item('b', ALIVE)], 'no');

    const order: string[] = [];
    manager.on('item-killed', (_g: string, name: string) => order.push(`item:${name}`));
    manager.on('group-stopped', () => order.push('group'));

    await manager.killGroup('g');

    assert.strictEqual(order[order.length - 1], 'group');
    assert.strictEqual(order.filter(o => o.startsWith('item:')).length, 2);
  });

  it('should name the group it is reporting for', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    const groups: string[] = [];
    manager.on('item-killed', (group: string) => groups.push(group));

    await manager.killGroup('g');

    assert.deepStrictEqual(groups, ['g']);
  });
});

describe('ProcessManager disabled items', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  it('should list a disabled item as stopped', () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('on', ALIVE), item('off', ALIVE)], 'no', ['off']);

    const items = manager.getGroupItems('g');
    assert.deepStrictEqual(items.map(i => i.name), ['on', 'off']);
    assert.strictEqual(items.find(i => i.name === 'off')!.status, 'stopped');
    assert.strictEqual(items.find(i => i.name === 'off')!.pid, null);
  });

  it('should leave enabled items running alongside disabled ones', () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('on', ALIVE), item('off', ALIVE)], 'no', ['off']);

    assert.strictEqual(manager.getGroupItems('g').find(i => i.name === 'on')!.status, 'running');
  });

  it('should not spawn a process for a disabled item', () => {
    manager = new ProcessManager();

    const spawned: string[] = [];
    manager.on('item-spawned', (_g: string, name: string) => spawned.push(name));

    manager.spawnGroup('g', [item('on', ALIVE), item('off', ALIVE)], 'no', ['off']);

    assert.deepStrictEqual(spawned, ['on']);
  });

  it('should start a disabled item on demand', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('off', ALIVE)], 'no', ['off']);

    manager.startItem('g', 'off');

    const status = manager.getGroupItems('g')[0];
    assert.strictEqual(status.status, 'running');
    assert.ok(status.pid !== null && status.pid > 0);
  });

  it('should restart a disabled item into a running one', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('off', ALIVE)], 'no', ['off']);

    await manager.restartItem('g', 'off');

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'running');
  });

  it('should treat stopping a never-started disabled item as a no-op', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('off', ALIVE)], 'no', ['off']);

    await manager.stopItem('g', 'off');

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'stopped');
  });

  it('should stop a started disabled item again', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('off', ALIVE)], 'no', ['off']);

    manager.startItem('g', 'off');
    await manager.stopItem('g', 'off');

    assert.strictEqual(manager.getGroupItems('g')[0].status, 'stopped');
  });

  it('should kill a group containing never-started disabled items', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('on', ALIVE), item('off', ALIVE)], 'no', ['off']);

    await manager.killGroup('g');

    assert.strictEqual(manager.isGroupRunning('g'), false);
  });
});

describe('ProcessManager child stdin', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  // The dashboard puts the parent terminal in raw mode, so children must not
  // share that stdin or the two compete for keystrokes.
  it('should give children an empty stdin when configured to ignore it', { timeout: 8000 }, async () => {
    manager = new ProcessManager({ childStdin: 'ignore' });

    const reported = new Promise<string>(resolve => {
      manager.on('process-log', (_g: string, _n: string, line: string) => resolve(line.trim()));
    });

    manager.spawnGroup(
      'g',
      [
        item(
          'reader',
          'node -e "process.stdin.resume();process.stdin.on(\'end\',()=>console.log(\'EOF\'));setTimeout(()=>console.log(\'OPEN\'),1500)"'
        )
      ],
      'no'
    );

    assert.strictEqual(await reported, 'EOF', 'ignored stdin closes immediately');
  });

  it('should default to inheriting stdin', () => {
    manager = new ProcessManager();
    assert.strictEqual(manager.childStdin, 'inherit');
  });
});

describe('ProcessManager UI events', () => {
  let manager: ProcessManager;

  afterEach(async () => {
    if (manager) await manager.killAll();
  });

  it('should emit item-spawned on the initial spawn', async () => {
    manager = new ProcessManager();

    const seen: Array<{ group: string; name: string; pid: number }> = [];
    manager.on('item-spawned', (group, name, pid) => seen.push({ group, name, pid }));

    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].group, 'g');
    assert.strictEqual(seen[0].name, 'a');
    assert.ok(seen[0].pid > 0);
  });

  it('should emit item-exited with the exit code', { timeout: 5000 }, async () => {
    manager = new ProcessManager();

    const exited = new Promise<number | null>(resolve => {
      manager.once('item-exited', (_g: string, _n: string, code: number | null) => resolve(code));
    });

    manager.spawnGroup('g', [item('a', 'node -e "process.exit(3)"')], 'no');

    assert.strictEqual(await exited, 3);
  });

  it('should emit item-restarting before the respawn', { timeout: 5000 }, async () => {
    manager = new ProcessManager();

    const restarting = new Promise<{ name: string; attempt: number }>(resolve => {
      manager.once('item-restarting', (_g: string, name: string, _delay: number, attempt: number) =>
        resolve({ name, attempt })
      );
    });

    manager.spawnGroup('g', [item('a', EXITS_NOW)], 'yes');

    const event = await restarting;
    assert.strictEqual(event.name, 'a');
    assert.strictEqual(event.attempt, 1);
  });

  it('should emit item-stopped on a manual stop', { timeout: 10000 }, async () => {
    manager = new ProcessManager();
    manager.spawnGroup('g', [item('a', ALIVE)], 'no');

    const stopped = new Promise<string>(resolve => {
      manager.once('item-stopped', (_g: string, name: string) => resolve(name));
    });

    await manager.stopItem('g', 'a');

    assert.strictEqual(await stopped, 'a');
  });

  it('should not write process output to stdout directly', { timeout: 5000 }, async () => {
    manager = new ProcessManager();

    const original = process.stdout.write.bind(process.stdout);
    const captured: string[] = [];
    (process.stdout as any).write = (chunk: any, ...rest: any[]) => {
      captured.push(String(chunk));
      return original(chunk, ...rest);
    };

    try {
      manager.spawnGroup('g', [item('talker', 'node -e "console.log(\'hello-from-child\')"')], 'no');
      await new Promise<void>(resolve => manager.once('process-log', () => resolve()));
      await wait(200);
    } finally {
      (process.stdout as any).write = original;
    }

    assert.ok(
      !captured.some(c => c.includes('hello-from-child')),
      'manager must emit process-log instead of writing to stdout'
    );
  });
});
