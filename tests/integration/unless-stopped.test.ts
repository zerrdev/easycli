/**
 * Tests for the `unless-stopped` restart policy, whose whole point is that a
 * manual stop outlives the run it was made in.
 *
 * os.homedir is redirected at a temp directory so the suite never touches the
 * real ~/.cligr, which may belong to a cligr instance running alongside it.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ProcessManager } from '../../src/process/manager.js';
import { StoppedStore } from '../../src/process/stopped-store.js';
import type { ProcessItem } from '../../src/config/types.js';

const LONG_RUNNING = 'node -e "setInterval(()=>{},1000)"';

let testHomeDir: string;
let manager: ProcessManager;
let store: StoppedStore;

/**
 * Every manager a test creates, so a failing assertion still leaves nothing
 * running: a surviving child keeps its pipes open and the runner never exits.
 */
let managers: ProcessManager[] = [];

function newManager(): ProcessManager {
  const created = new ProcessManager();
  managers.push(created);
  return created;
}

async function killEverything(): Promise<void> {
  await Promise.all(managers.map(m => m.killAll()));
  managers = [];
}

function items(...names: string[]): ProcessItem[] {
  return names.map(name => ({ name, args: [], fullCmd: LONG_RUNNING }));
}

describe('unless-stopped restart policy', () => {
  before(() => {
    testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-unless-stopped-'));
    mock.method(os, 'homedir', () => testHomeDir);
  });

  after(async () => {
    await killEverything();
    mock.restoreAll();
    fs.rmSync(testHomeDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await killEverything();
    fs.rmSync(path.join(testHomeDir, '.cligr', 'state'), { recursive: true, force: true });
    manager = newManager();
    store = new StoppedStore();
  });

  it('should remember an item stopped by hand', async () => {
    manager.spawnGroup('remembers', items('api', 'worker'), 'unless-stopped');

    await manager.stopItem('remembers', 'worker');

    assert.deepStrictEqual(await store.read('remembers'), ['worker']);
  });

  it('should not remember a stop when the policy is yes', async () => {
    manager.spawnGroup('forgets', items('api', 'worker'), 'yes');

    await manager.stopItem('forgets', 'worker');

    assert.deepStrictEqual(await store.read('forgets'), []);
  });

  it('should forget a remembered stop once the item is started again', async () => {
    manager.spawnGroup('restarts', items('api', 'worker'), 'unless-stopped');
    await manager.stopItem('restarts', 'worker');

    manager.startItem('restarts', 'worker');
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.deepStrictEqual(await store.read('restarts'), []);
  });

  it('should leave a remembered item stopped on the next run', async () => {
    manager.spawnGroup('next-run', items('api', 'worker'), 'unless-stopped');
    await manager.stopItem('next-run', 'worker');
    await manager.killGroup('next-run');

    const nextRun = newManager();
    const remembered = await store.read('next-run');
    nextRun.spawnGroup('next-run', items('api', 'worker'), 'unless-stopped', remembered);

    const statuses = nextRun.getGroupItems('next-run');
    assert.strictEqual(statuses.find(i => i.name === 'worker')?.status, 'stopped');
    assert.strictEqual(statuses.find(i => i.name === 'api')?.status, 'running');
  });
});
