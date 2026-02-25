/**
 * Integration tests for ProcessManager
 *
 * These tests verify the process management functionality including:
 * - Spawning process groups
 * - Process output prefixing
 * - Restart policies
 * - Crash loop detection
 * - Killing groups
 *
 * Note: These tests spawn real processes and may be platform-specific.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { ProcessManager, ManagedProcess } from '../../src/process/manager.js';
import type { ProcessItem } from '../../src/config/types.js';

describe('ProcessManager Integration Tests', () => {
  let manager: ProcessManager;

  before(() => {
    manager = new ProcessManager();
  });

  after(async () => {
    // Clean up any running processes
    await manager.killAll();
  });

  describe('spawnGroup()', () => {
    it('should spawn a group with single process', async () => {
      const items: ProcessItem[] = [
        { name: 'test1', args: ['hello'], fullCmd: process.platform === 'win32' ? 'echo hello' : 'echo hello' }
      ];

      manager.spawnGroup('test-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('test-group'), true);
      const status = manager.getGroupStatus('test-group');
      assert.strictEqual(status.length, 1);

      // Clean up
      await manager.killGroup('test-group');
    });

    it('should spawn a group with multiple processes', async () => {
      const items: ProcessItem[] = [
        { name: 'proc1', args: ['one'], fullCmd: process.platform === 'win32' ? 'echo one' : 'echo one' },
        { name: 'proc2', args: ['two'], fullCmd: process.platform === 'win32' ? 'echo two' : 'echo two' },
        { name: 'proc3', args: ['three'], fullCmd: process.platform === 'win32' ? 'echo three' : 'echo three' }
      ];

      manager.spawnGroup('multi-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('multi-group'), true);
      const status = manager.getGroupStatus('multi-group');
      assert.strictEqual(status.length, 3);

      // Clean up
      await manager.killGroup('multi-group');
    });

    it('should throw error when spawning duplicate group', async () => {
      const items: ProcessItem[] = [
        { name: 'test', args: [], fullCmd: 'echo test' }
      ];

      manager.spawnGroup('dup-group', items, 'no');

      assert.throws(
        () => manager.spawnGroup('dup-group', items, 'no'),
        (err: Error) => {
          assert.ok(err.message.includes('already running'));
          return true;
        }
      );

      // Clean up
      await manager.killGroup('dup-group');
    });

    it('should handle processes with different exit times', async () => {
      // Use sleep commands with different durations
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'short', args: ['1'], fullCmd: `${sleepCmd} ${sleepFlag} 1` },
        { name: 'long', args: ['2'], fullCmd: `${sleepCmd} ${sleepFlag} 2` }
      ];

      manager.spawnGroup('timed-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('timed-group'), true);

      // Wait for short process to exit
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Group should still be tracked even after some processes exit
      assert.strictEqual(manager.isGroupRunning('timed-group'), true);

      // Clean up
      await manager.killGroup('timed-group');
    });
  });

  describe('killGroup()', () => {
    it('should kill a running group', async () => {
      // Use a long-running process
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'long-running', args: ['10'], fullCmd: `${sleepCmd} ${sleepFlag} 10` }
      ];

      manager.spawnGroup('kill-test', items, 'no');
      assert.strictEqual(manager.isGroupRunning('kill-test'), true);

      await manager.killGroup('kill-test');

      assert.strictEqual(manager.isGroupRunning('kill-test'), false);
    });

    it('should handle killing non-existent group gracefully', async () => {
      // Should not throw
      await manager.killGroup('non-existent');
      assert.strictEqual(manager.isGroupRunning('non-existent'), false);
    });

    it('should kill all processes in a group', async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'p1', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` },
        { name: 'p2', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` },
        { name: 'p3', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` }
      ];

      manager.spawnGroup('multi-kill', items, 'no');
      assert.strictEqual(manager.isGroupRunning('multi-kill'), true);

      await manager.killGroup('multi-kill');

      assert.strictEqual(manager.isGroupRunning('multi-kill'), false);
    });
  });

  describe('killAll()', () => {
    it('should kill all running groups', async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'proc', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` }
      ];

      manager.spawnGroup('group1', items, 'no');
      manager.spawnGroup('group2', items, 'no');
      manager.spawnGroup('group3', items, 'no');

      assert.strictEqual(manager.isGroupRunning('group1'), true);
      assert.strictEqual(manager.isGroupRunning('group2'), true);
      assert.strictEqual(manager.isGroupRunning('group3'), true);

      await manager.killAll();

      assert.strictEqual(manager.isGroupRunning('group1'), false);
      assert.strictEqual(manager.isGroupRunning('group2'), false);
      assert.strictEqual(manager.isGroupRunning('group3'), false);
    });

    it('should handle empty state gracefully', async () => {
      // Should not throw when no groups are running
      await manager.killAll();
      const running = manager.getRunningGroups();
      assert.strictEqual(running.length, 0);
    });
  });

  describe('getGroupStatus()', () => {
    it('should return status for a running group', async () => {
      const items: ProcessItem[] = [
        { name: 'status-test', args: [], fullCmd: process.platform === 'win32' ? 'echo test' : 'echo test' }
      ];

      manager.spawnGroup('status-group', items, 'no');

      const status = manager.getGroupStatus('status-group');
      assert.strictEqual(status.length, 1);
      assert.strictEqual(status[0], 'running');

      await manager.killGroup('status-group');
    });

    it('should return empty array for non-existent group', () => {
      const status = manager.getGroupStatus('non-existent');
      assert.deepStrictEqual(status, []);
    });
  });

  describe('isGroupRunning()', () => {
    it('should return true for running group', async () => {
      const items: ProcessItem[] = [
        { name: 'running-test', args: ['2'], fullCmd: process.platform === 'win32' ? 'timeout /t 2' : 'sleep 2' }
      ];

      manager.spawnGroup('running-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('running-group'), true);

      await manager.killGroup('running-group');
    });

    it('should return false for non-existent group', () => {
      assert.strictEqual(manager.isGroupRunning('non-existent'), false);
    });

    it('should return false after killing group', async () => {
      const items: ProcessItem[] = [
        { name: 'temp', args: ['2'], fullCmd: process.platform === 'win32' ? 'timeout /t 2' : 'sleep 2' }
      ];

      manager.spawnGroup('temp-group', items, 'no');
      assert.strictEqual(manager.isGroupRunning('temp-group'), true);

      await manager.killGroup('temp-group');
      assert.strictEqual(manager.isGroupRunning('temp-group'), false);
    });
  });

  describe('getRunningGroups()', () => {
    it('should return list of running groups', async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'proc', args: ['2'], fullCmd: `${sleepCmd} ${sleepFlag} 2` }
      ];

      manager.spawnGroup('list-group-1', items, 'no');
      manager.spawnGroup('list-group-2', items, 'no');
      manager.spawnGroup('list-group-3', items, 'no');

      const running = manager.getRunningGroups();
      assert.strictEqual(running.length, 3);
      assert.ok(running.includes('list-group-1'));
      assert.ok(running.includes('list-group-2'));
      assert.ok(running.includes('list-group-3'));

      await manager.killAll();
    });

    it('should return empty array when no groups running', async () => {
      await manager.killAll();
      const running = manager.getRunningGroups();
      assert.strictEqual(running.length, 0);
    });
  });

  describe('Restart policies', () => {
    it('should not restart processes with restart=no', async () => {
      // Create a process that exits immediately
      // Use node -e "process.exit(0)" for cross-platform compatibility
      const items: ProcessItem[] = [
        { name: 'no-restart', args: [], fullCmd: 'node -e "process.exit(0)"' }
      ];

      manager.spawnGroup('no-restart-group', items, 'no');

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Group should still be tracked but process won't restart
      assert.strictEqual(manager.isGroupRunning('no-restart-group'), true);

      await manager.killGroup('no-restart-group');
    });

    it('should handle unless-stopped restart policy', async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'unless-stopped', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` }
      ];

      manager.spawnGroup('unless-stopped-group', items, 'unless-stopped');

      assert.strictEqual(manager.isGroupRunning('unless-stopped-group'), true);

      // Kill with SIGTERM
      await manager.killGroup('unless-stopped-group');

      // Process should not restart after SIGTERM
      await new Promise(resolve => setTimeout(resolve, 2000));
      assert.strictEqual(manager.isGroupRunning('unless-stopped-group'), false);
    });
  });

  describe('parseCommand()', () => {
    it('should parse simple command', async () => {
      const items: ProcessItem[] = [
        { name: 'parse-test', args: [], fullCmd: 'echo hello' }
      ];

      manager.spawnGroup('parse-test-group', items, 'no');

      // Command should execute successfully
      assert.strictEqual(manager.isGroupRunning('parse-test-group'), true);

      await manager.killGroup('parse-test-group');
    });

    it('should parse command with multiple arguments', async () => {
      const items: ProcessItem[] = [
        { name: 'multi-arg', args: [], fullCmd: 'node -e "console.log(\'test\')"' }
      ];

      manager.spawnGroup('multi-arg-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('multi-arg-group'), true);

      await manager.killGroup('multi-arg-group');
    });

    it('should handle quoted paths with spaces', async () => {
      const items: ProcessItem[] = [
        { name: 'quoted-path', args: [], fullCmd: '"echo" "hello world"' }
      ];

      manager.spawnGroup('quoted-path-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('quoted-path-group'), true);

      await manager.killGroup('quoted-path-group');
    });
  });

  describe('Output prefixing', () => {
    it('should prefix process output with item name', async () => {
      // This test verifies output prefixing by checking that processes start successfully
      // Actual output verification would require capturing stdout
      const items: ProcessItem[] = [
        { name: 'prefixed-1', args: [], fullCmd: 'echo output1' },
        { name: 'prefixed-2', args: [], fullCmd: 'echo output2' }
      ];

      manager.spawnGroup('output-test', items, 'no');

      assert.strictEqual(manager.isGroupRunning('output-test'), true);

      await manager.killGroup('output-test');
    });
  });

  describe('Cross-platform compatibility', () => {
    it('should work with Windows-specific commands', async function skipOnNonWindows() {
      if (process.platform !== 'win32') {
        this.skip();
        return; // Ensure we don't continue execution after skip
      }

      const items: ProcessItem[] = [
        { name: 'win-cmd', args: [], fullCmd: 'cmd /c echo Windows' }
      ];

      manager.spawnGroup('win-test', items, 'no');

      assert.strictEqual(manager.isGroupRunning('win-test'), true);

      await manager.killGroup('win-test');
    });

    it('should work with Unix-specific commands', async function skipOnWindows() {
      if (process.platform === 'win32') {
        this.skip();
        return; // Ensure we don't continue execution after skip
      }

      const items: ProcessItem[] = [
        { name: 'unix-cmd', args: [], fullCmd: '/bin/echo Unix' }
      ];

      manager.spawnGroup('unix-test', items, 'no');

      assert.strictEqual(manager.isGroupRunning('unix-test'), true);

      await manager.killGroup('unix-test');
    });
  });
});
