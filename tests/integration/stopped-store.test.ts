/**
 * Tests for the store that remembers manual stops between runs.
 *
 * os.homedir is redirected at a temp directory so the suite never touches the
 * real ~/.cligr/state, which may belong to a cligr instance running alongside it.
 */

import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StoppedStore, stoppedAtStartup } from '../../src/process/stopped-store.js';

let testHomeDir: string;
let stateDir: string;
let store: StoppedStore;

describe('StoppedStore', () => {
  before(() => {
    testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-stopped-test-'));
    mock.method(os, 'homedir', () => testHomeDir);
    stateDir = path.join(testHomeDir, '.cligr', 'state');
  });

  after(() => {
    mock.restoreAll();
    fs.rmSync(testHomeDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    store = new StoppedStore();
  });

  it('should remember an item that was added', async () => {
    await store.add('myapp', 'worker');

    assert.deepStrictEqual(await store.read('myapp'), ['worker']);
  });

  it('should record an item once however often it is added', async () => {
    await store.add('myapp', 'worker');
    await store.add('myapp', 'worker');

    assert.deepStrictEqual(await store.read('myapp'), ['worker']);
  });

  it('should forget an item that was removed', async () => {
    await store.add('myapp', 'worker');
    await store.add('myapp', 'scheduler');

    await store.remove('myapp', 'worker');

    assert.deepStrictEqual(await store.read('myapp'), ['scheduler']);
  });

  it('should report nothing stopped for a group it has never seen', async () => {
    assert.deepStrictEqual(await store.read('never-run'), []);
  });

  it('should not write a state file for a group with nothing to forget', async () => {
    await store.remove('never-stopped', 'worker');

    assert.strictEqual(fs.existsSync(path.join(stateDir, 'never-stopped.json')), false);
  });

  it('should keep groups separate', async () => {
    await store.add('myapp', 'worker');
    await store.add('tunnels', 'grafana');

    assert.deepStrictEqual(await store.read('myapp'), ['worker']);
    assert.deepStrictEqual(await store.read('tunnels'), ['grafana']);
  });
});

describe('stoppedAtStartup', () => {
  it('should leave remembered stops down under unless-stopped', () => {
    const stopped = stoppedAtStartup({
      disabledNames: ['scheduler'],
      remembered: ['worker'],
      repeating: false,
      restart: 'unless-stopped'
    });

    assert.deepStrictEqual(stopped.sort(), ['scheduler', 'worker']);
  });

  it('should ignore remembered stops under any other policy', () => {
    for (const restart of ['yes', 'no', undefined] as const) {
      const stopped = stoppedAtStartup({
        disabledNames: ['scheduler'],
        remembered: ['worker'],
        repeating: false,
        restart
      });

      assert.deepStrictEqual(stopped, ['scheduler'], `policy ${restart}`);
    }
  });

  it('should not list an item twice when it is both disabled and remembered', () => {
    const stopped = stoppedAtStartup({
      disabledNames: ['worker'],
      remembered: ['worker'],
      repeating: false,
      restart: 'unless-stopped'
    });

    assert.deepStrictEqual(stopped, ['worker']);
  });

  it('should stop nothing for a repeating group, which runs as one process', () => {
    const stopped = stoppedAtStartup({
      disabledNames: ['scheduler'],
      remembered: ['worker'],
      repeating: true,
      restart: 'unless-stopped'
    });

    assert.deepStrictEqual(stopped, []);
  });
});
