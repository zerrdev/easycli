/**
 * Tests for the non-TTY output path.
 *
 * PlainLogger must reproduce the output cligr produced before the dashboard
 * existed, since it is what pipes, redirects and CI see.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { ProcessManager } from '../../src/process/manager.js';
import { PlainLogger } from '../../src/ui/plain-logger.js';

describe('PlainLogger', () => {
  let manager: ProcessManager;
  let logger: PlainLogger;
  let out: string[];

  function setup(groupName = 'g') {
    manager = new ProcessManager();
    out = [];
    logger = new PlainLogger({
      manager,
      groupName,
      writeOut: line => out.push(line),
      writeErr: line => out.push(line)
    });
    logger.start();
  }

  afterEach(async () => {
    if (logger) logger.stop();
    if (manager) await manager.killAll();
  });

  it('should prefix stdout lines with the item name', () => {
    setup();

    manager.emit('process-log', 'g', 'api', 'GET /users 200', false);

    assert.deepStrictEqual(out, ['[api] GET /users 200']);
  });

  it('should prefix stderr lines with the item name', () => {
    setup();

    manager.emit('process-log', 'g', 'api', 'boom', true);

    assert.deepStrictEqual(out, ['[api] boom']);
  });

  it('should ignore output from other groups', () => {
    setup();

    manager.emit('process-log', 'other', 'api', 'not mine', false);

    assert.deepStrictEqual(out, []);
  });

  it('should report restarts with the exit code', () => {
    setup();

    manager.emit('item-exited', 'g', 'api', 1, null);
    manager.emit('item-restarting', 'g', 'api', 1000, 1);

    assert.ok(out.includes('[api] Restarting... (exit code: 1)'));
  });

  it('should report a restart with no exit code when killed by signal', () => {
    setup();

    manager.emit('item-exited', 'g', 'api', null, 'SIGTERM');
    manager.emit('item-restarting', 'g', 'api', 1000, 1);

    assert.ok(out.includes('[api] Restarting... (exit code: null)'));
  });

  it('should report crash loops', () => {
    setup();

    manager.emit('item-crash-looped', 'g', 'api');

    assert.ok(out.includes('[api] Crash loop detected. Stopping restarts.'));
  });

  it('should stop writing after stop', () => {
    setup();
    logger.stop();

    manager.emit('process-log', 'g', 'api', 'after stop', false);

    assert.deepStrictEqual(out, []);
  });

  it('should tolerate being stopped twice', () => {
    setup();

    logger.stop();
    logger.stop();
  });
});
