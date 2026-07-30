/**
 * Integration tests for the one-shot runner (mode: once).
 *
 * These spawn real node children. Children in the raw-stdio paths must never
 * write to stdout, or their output would land in the test runner's TAP stream.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runOnce } from '../../src/process/one-shot.js';
import type { ProcessItem } from '../../src/config/types.js';

describe('runOnce', () => {
  let workDir: string;
  let out: string[];
  let err: string[];

  const writers = () => ({
    writeOut: (line: string) => { out.push(line); },
    writeErr: (line: string) => { err.push(line); }
  });

  /** A child running `script`. Avoid double quotes inside script. */
  const item = (name: string, script: string): ProcessItem => ({
    name,
    args: [],
    fullCmd: `"${process.execPath}" -e "${script}"`
  });

  /** Path usable inside a child's inline script. */
  const filePath = (name: string): string =>
    path.join(workDir, name).split(path.sep).join('/');

  before(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-once-'));
  });

  after(() => {
    if (fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    out = [];
    err = [];
  });

  describe('single item', () => {
    it('should return the exit code of the only item', async () => {
      const code = await runOnce({
        items: [item('solo', 'process.exit(3)')],
        ...writers()
      });

      assert.strictEqual(code, 3);
    });

    it('should return 0 when the only item succeeds', async () => {
      const code = await runOnce({
        items: [item('solo', 'process.exit(0)')],
        ...writers()
      });

      assert.strictEqual(code, 0);
    });

    it('should not prefix output when there is a single item', async () => {
      await runOnce({
        items: [item('solo', 'process.exit(0)')],
        ...writers()
      });

      // Raw passthrough hands the child our streams directly, so the runner
      // itself emits nothing.
      assert.deepStrictEqual(out, []);
    });

    it('should report a failing item on stderr', async () => {
      await runOnce({
        items: [item('solo', 'process.exit(7)')],
        ...writers()
      });

      assert.ok(
        err.some(line => line.includes('solo') && line.includes('7')),
        `expected a failure line naming solo and 7, got ${JSON.stringify(err)}`
      );
    });
  });

  describe('parallel with several items', () => {
    it('should prefix stdout lines with the item name', async () => {
      const code = await runOnce({
        items: [
          item('alpha', "console.log('one')"),
          item('beta', "console.log('two')")
        ],
        ...writers()
      });

      assert.strictEqual(code, 0);
      assert.ok(out.includes('[alpha] one'), `got ${JSON.stringify(out)}`);
      assert.ok(out.includes('[beta] two'), `got ${JSON.stringify(out)}`);
    });

    it('should route child stderr through the error writer', async () => {
      await runOnce({
        items: [
          item('alpha', "console.error('bad')"),
          item('beta', "console.log('good')")
        ],
        ...writers()
      });

      assert.ok(err.includes('[alpha] bad'), `got ${JSON.stringify(err)}`);
      assert.ok(out.includes('[beta] good'), `got ${JSON.stringify(out)}`);
    });

    it('should return 0 when every item succeeds', async () => {
      const code = await runOnce({
        items: [
          item('alpha', 'process.exit(0)'),
          item('beta', 'process.exit(0)')
        ],
        ...writers()
      });

      assert.strictEqual(code, 0);
    });

    it('should return the first non-zero code in config order, not the first to fail', async () => {
      const code = await runOnce({
        items: [
          item('slow', 'setTimeout(()=>process.exit(3),400)'),
          item('fast', 'process.exit(4)')
        ],
        ...writers()
      });

      assert.strictEqual(code, 3);
    });

    it('should wait for every item before resolving', async () => {
      const marker = filePath('parallel-slow.txt');

      await runOnce({
        items: [
          item('quick', 'process.exit(0)'),
          item('slow', `setTimeout(()=>require('fs').writeFileSync('${marker}','done'),300)`)
        ],
        ...writers()
      });

      assert.strictEqual(fs.readFileSync(marker, 'utf-8'), 'done');
    });
  });

  describe('sequential', () => {
    it('should stop at the first failure', async () => {
      const marker = filePath('never-runs.txt');

      const code = await runOnce({
        sequential: true,
        items: [
          item('first', 'process.exit(2)'),
          item('second', `require('fs').writeFileSync('${marker}','ran')`)
        ],
        ...writers()
      });

      assert.strictEqual(code, 2);
      assert.strictEqual(fs.existsSync(marker), false, 'second item must not run');
    });

    it('should run every item in config order when each succeeds', async () => {
      const marker = filePath('order.txt');

      const code = await runOnce({
        sequential: true,
        items: [
          item('first', `require('fs').appendFileSync('${marker}','1')`),
          item('second', `require('fs').appendFileSync('${marker}','2')`),
          item('third', `require('fs').appendFileSync('${marker}','3')`)
        ],
        ...writers()
      });

      assert.strictEqual(code, 0);
      assert.strictEqual(fs.readFileSync(marker, 'utf-8'), '123');
    });

    it('should write a step header before each item', async () => {
      await runOnce({
        sequential: true,
        items: [
          item('first', 'process.exit(0)'),
          item('second', 'process.exit(0)')
        ],
        ...writers()
      });

      assert.deepStrictEqual(err, ['→ first', '→ second']);
    });

    it('should not write a step header for a single item', async () => {
      await runOnce({
        sequential: true,
        items: [item('solo', 'process.exit(0)')],
        ...writers()
      });

      assert.deepStrictEqual(err, []);
    });

    it('should not prefix output, since only one child runs at a time', async () => {
      await runOnce({
        sequential: true,
        items: [
          item('first', 'process.exit(0)'),
          item('second', 'process.exit(0)')
        ],
        ...writers()
      });

      assert.deepStrictEqual(out, []);
    });
  });

  describe('nothing to run', () => {
    it('should return 0 for an empty item list', async () => {
      const code = await runOnce({ items: [], ...writers() });

      assert.strictEqual(code, 0);
    });
  });

  describe('interruption', () => {
    it('should kill the running child and report 130 on SIGINT', async () => {
      const pending = runOnce({
        items: [item('sleeper', "require('net').createServer().listen(0)")],
        ...writers()
      });

      // Give the child time to come up before interrupting.
      await new Promise(resolve => setTimeout(resolve, 400));
      process.emit('SIGINT' as NodeJS.Signals);

      const code = await pending;

      assert.strictEqual(code, 130);
    });

    it('should stop a sequential run at the interrupted step', async () => {
      const marker = filePath('after-interrupt.txt');

      const pending = runOnce({
        sequential: true,
        items: [
          item('blocker', "require('net').createServer().listen(0)"),
          item('later', `require('fs').writeFileSync('${marker}','ran')`)
        ],
        ...writers()
      });

      await new Promise(resolve => setTimeout(resolve, 400));
      process.emit('SIGINT' as NodeJS.Signals);

      const code = await pending;

      assert.strictEqual(code, 130);
      assert.strictEqual(fs.existsSync(marker), false, 'later item must not run');
    });
  });

  describe('failures', () => {
    it('should treat a child that fails to spawn as a failure', async () => {
      const code = await runOnce({
        items: [{ name: 'missing', args: [], fullCmd: 'definitely-not-a-real-binary-xyz' }],
        ...writers()
      });

      assert.notStrictEqual(code, 0);
    });
  });
});
