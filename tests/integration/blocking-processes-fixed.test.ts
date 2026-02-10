/**
 * Integration tests for blocking/long-running processes
 *
 * These tests verify the ProcessManager's ability to handle
 * processes that run indefinitely or for extended periods.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { ProcessManager } from '../../src/process/manager.js';
import type { ProcessItem } from '../../src/config/types.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('Blocking Processes Integration Tests', () => {
  let manager: ProcessManager;
  let testScriptsDir: string;

  before(() => {
    manager = new ProcessManager();
    testScriptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-blocking-test-'));
  });

  after(() => {
    // Clean up any running processes
    manager.killAll();

    // Clean up test scripts directory
    if (fs.existsSync(testScriptsDir)) {
      fs.rmSync(testScriptsDir, { recursive: true, force: true });
    }
  });

  function createInfiniteLoopScript(scriptName: string, delayMs: number = 1000): string {
    const scriptPath = path.join(testScriptsDir, scriptName);
    const scriptContent = `
// Infinite loop script - simulates a long-running process
let counter = 0;
const interval = setInterval(() => {
  counter++;
  console.log(\`${scriptName}: \${counter}\`);
}, ${delayMs});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGINT', () => {
  clearInterval(interval);
  process.exit(0);
});
`;
    fs.writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }

  function createServerScript(scriptName: string, port: number): string {
    const scriptPath = path.join(testScriptsDir, scriptName);
    const scriptContent = `
// HTTP server script - simulates a service that stays running
import http from 'http';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK\\n');
});

server.listen(${port}, () => {
  console.log(\`${scriptName}: listening on port \${port}\`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
`;
    fs.writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }

  describe('Multiple processes spawn in parallel', () => {
    it('should spawn all processes concurrently', { timeout: 10000 }, async () => {
      const scriptPath = createInfiniteLoopScript('concurrent.js', 500);

      const items: ProcessItem[] = [
        { name: 'proc1', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'proc2', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'proc3', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'proc4', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'proc5', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      const start = Date.now();
      manager.spawnGroup('concurrent-group', items, 'no');
      const elapsed = Date.now() - start;

      // spawnGroup should return quickly (all processes started in parallel)
      assert.ok(elapsed < 1000, `spawnGroup took ${elapsed}ms, expected < 1000ms`);

      // Verify all processes are tracked
      assert.strictEqual(manager.isGroupRunning('concurrent-group'), true);

      // Wait for processes to start and run a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Kill the group
      manager.killGroup('concurrent-group');

      // Verify processes were killed
      assert.strictEqual(manager.isGroupRunning('concurrent-group'), false);
    });

    it('should handle many concurrent processes', { timeout: 15000 }, async () => {
      const scriptPath = createInfiniteLoopScript('many.js', 1000);
      const items: ProcessItem[] = [];

      // Create 20 items
      for (let i = 0; i < 20; i++) {
        items.push({
          name: `proc${i}`,
          args: [scriptPath],
          fullCmd: `node ${scriptPath}`
        });
      }

      const start = Date.now();
      manager.spawnGroup('many-group', items, 'no');
      const elapsed = Date.now() - start;

      // Should spawn 20 processes quickly
      assert.ok(elapsed < 2000, `spawnGroup took ${elapsed}ms, expected < 2000ms`);

      assert.strictEqual(manager.isGroupRunning('many-group'), true);

      // Let them run
      await new Promise(resolve => setTimeout(resolve, 2000));

      manager.killGroup('many-group');
      assert.strictEqual(manager.isGroupRunning('many-group'), false);
    });
  });

  describe('Server processes', () => {
    it('should manage multiple server processes on different ports', { timeout: 10000 }, async () => {
      const ports = [18100, 18101, 18102];
      const items: ProcessItem[] = [];

      for (const port of ports) {
        const scriptPath = createServerScript(`server-${port}.js`, port);
        items.push({
          name: `server-${port}`,
          args: [scriptPath],
          fullCmd: `node ${scriptPath}`
        });
      }

      manager.spawnGroup('server-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('server-group'), true);

      // Wait for servers to start
      await new Promise(resolve => setTimeout(resolve, 1500));

      manager.killGroup('server-group');
      assert.strictEqual(manager.isGroupRunning('server-group'), false);
    });
  });

  describe('Long-running processes', () => {
    it('should manage processes with long execution time', { timeout: 10000 }, async () => {
      // Use sleep command for long-running processes
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepArg = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'long1', args: [sleepArg, '5'], fullCmd: `${sleepCmd} ${sleepArg} 5` },
        { name: 'long2', args: [sleepArg, '5'], fullCmd: `${sleepCmd} ${sleepArg} 5` },
        { name: 'long3', args: [sleepArg, '5'], fullCmd: `${sleepCmd} ${sleepArg} 5` }
      ];

      manager.spawnGroup('long-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('long-group'), true);

      // Wait a bit then kill before they complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      manager.killGroup('long-group');
      assert.strictEqual(manager.isGroupRunning('long-group'), false);
    });
  });

  describe('Process lifecycle verification', () => {
    it('should track process status correctly', { timeout: 10000 }, async () => {
      const scriptPath = createInfiniteLoopScript('status.js', 500);

      const items: ProcessItem[] = [
        { name: 'status1', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'status2', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('status-group', items, 'no');

      // Check status
      const status = manager.getGroupStatus('status-group');
      assert.strictEqual(status.length, 2);
      assert.strictEqual(status[0], 'running');
      assert.strictEqual(status[1], 'running');

      // Check running groups
      const runningGroups = manager.getRunningGroups();
      assert.ok(runningGroups.includes('status-group'));

      await new Promise(resolve => setTimeout(resolve, 1000));

      manager.killGroup('status-group');

      // After killing, group should not be running
      assert.strictEqual(manager.isGroupRunning('status-group'), false);
    });
  });

  describe('Cleanup verification', () => {
    it('should properly clean up all processes', { timeout: 10000 }, async () => {
      const scriptPath = createInfiniteLoopScript('cleanup.js', 500);

      // Create multiple groups
      for (let i = 0; i < 3; i++) {
        const items: ProcessItem[] = [
          { name: `cleanup${i}-1`, args: [scriptPath], fullCmd: `node ${scriptPath}` },
          { name: `cleanup${i}-2`, args: [scriptPath], fullCmd: `node ${scriptPath}` }
        ];

        manager.spawnGroup(`cleanup-group-${i}`, items, 'no');
      }

      // All groups should be running
      assert.strictEqual(manager.getRunningGroups().length, 3);

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Kill all at once
      manager.killAll();

      // All groups should be cleaned up
      assert.strictEqual(manager.getRunningGroups().length, 0);
    });
  });
});
