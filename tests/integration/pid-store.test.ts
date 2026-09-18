/**
 * Tests for the PID store's staleness rules.
 *
 * os.homedir is redirected at a temp directory so the suite never touches the
 * real ~/.cligr/pids, which may belong to a cligr instance running alongside it.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PidStore, type PidEntry } from '../../src/process/pid-store.js';

const ONE_HOUR = 60 * 60 * 1000;

let testHomeDir: string;
let pidsDir: string;
let store: PidStore;

/** A PID nothing is using, found with the same liveness check under test. */
function freePid(): number {
  for (let pid = 900_000; pid < 900_400; pid += 4) {
    if (!store.isPidRunning(pid)) return pid;
  }
  throw new Error('no free PID available to test with');
}

function entry(groupName: string, itemName: string, pid: number, ageMs: number): PidEntry {
  return {
    pid,
    groupName,
    itemName,
    startTime: Date.now() - ageMs,
    restartPolicy: 'yes',
    fullCmd: 'node -e ""'
  };
}

describe('PidStore staleness', () => {
  before(() => {
    testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-pid-test-'));
    mock.method(os, 'homedir', () => testHomeDir);
    pidsDir = path.join(testHomeDir, '.cligr', 'pids');
  });

  after(() => {
    mock.restoreAll();
    fs.rmSync(testHomeDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(pidsDir, { recursive: true, force: true });
    store = new PidStore();
  });

  describe('isPidEntryValid', () => {
    it('should treat a long-running process as valid', () => {
      const alive = entry('g', 'a', process.pid, ONE_HOUR);

      assert.strictEqual(store.isPidEntryValid(alive), true);
    });

    it('should treat a process that is gone as invalid', () => {
      const dead = entry('g', 'a', freePid(), 0);

      assert.strictEqual(store.isPidEntryValid(dead), false);
    });
  });

  describe('cleanupStalePids', () => {
    it('should remove entries whose process is gone', async () => {
      await store.writePid(entry('mine', 'dead', freePid(), 0));

      await store.cleanupStalePids('mine');

      assert.deepStrictEqual(fs.readdirSync(pidsDir), []);
    });

    it('should keep entries whose process is still running', async () => {
      await store.writePid(entry('mine', 'alive', process.pid, ONE_HOUR));

      await store.cleanupStalePids('mine');

      assert.deepStrictEqual(fs.readdirSync(pidsDir), ['mine_alive.pid']);
    });

    it('should leave another group untouched', async () => {
      await store.writePid(entry('other', 'alive', process.pid, ONE_HOUR));
      await store.writePid(entry('mine', 'dead', freePid(), 0));

      await store.cleanupStalePids('mine');

      assert.deepStrictEqual(fs.readdirSync(pidsDir), ['other_alive.pid']);
    });

    it('should report the entries it removed', async () => {
      await store.writePid(entry('mine', 'dead', freePid(), 0));

      const removed = await store.cleanupStalePids('mine');

      assert.strictEqual(removed.length, 1);
      assert.strictEqual(removed[0].itemName, 'dead');
    });
  });
});
