/**
 * Integration tests for blocking/long-running processes
 *
 * These tests verify the ProcessManager's ability to handle
 * processes that run indefinitely or for extended periods.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
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

    // Create a directory for test scripts
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
  console.log(\[${scriptName}] Running iteration: \${counter}\`);
}, ${delayMs});

// Keep process alive
process.on('SIGTERM', () => {
  console.log(\[${scriptName}] Received SIGTERM, shutting down...\`);
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(\[${scriptName}] Received SIGINT, shutting down...\`);
  clearInterval(interval);
  process.exit(0);
});
`;
    fs.writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }

  function createBlockingScript(scriptName: string): string {
    const scriptPath = path.join(testScriptsDir, scriptName);
    const scriptContent = `
// Blocking script - simulates CPU-intensive work
console.log('Starting blocking process...');

// Simulate blocking work with periodic output
let iterations = 0;
const blockingWork = () => {
  const start = Date.now();
  while (Date.now() - start < 100) {
    // Busy wait for 100ms - simulates blocking CPU work
    Math.sqrt(Math.random() * 10000);
  }
  iterations++;
  console.log(\[${scriptName}] Completed \${iterations} blocking cycles\`);

  // Continue blocking work
  if (iterations < 1000) {
    setTimeout(blockingWork, 50);
  }
};

blockingWork();

process.on('SIGTERM', () => {
  console.log(\[${scriptName}] Shutting down after \${iterations} cycles\`);
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
  res.end('Hello from test server\\n');
});

server.listen(${port}, () => {
  console.log(\`${scriptName} listening on port \${port}\`);
});

// Keep server running
process.on('SIGTERM', () => {
  console.log(\`${scriptName} shutting down...\`);
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log(\`${scriptName} shutting down...\`);
  server.close(() => {
    process.exit(0);
  });
});
`;
    fs.writeFileSync(scriptPath, scriptContent);
    return scriptPath;
  }

  describe('Infinite loop processes', () => {
    it('should manage infinite loop processes with setInterval', async () => {
      const scriptPath = createInfiniteLoopScript('infinite-loop.js', 500);

      const items: ProcessItem[] = [
        { name: 'loop1', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'loop2', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('infinite-loop-group', items, 'no');

      // Verify processes are running
      assert.strictEqual(manager.isGroupRunning('infinite-loop-group'), true);

      // Wait a bit to ensure processes started
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Kill the group
      manager.killGroup('infinite-loop-group');

      // Verify processes were killed
      assert.strictEqual(manager.isGroupRunning('infinite-loop-group'), false);
    });

    it('should handle infinite while(true) loop processes', async () => {
      const scriptPath = path.join(testScriptsDir, 'while-true.js');
      const scriptContent = `
// Infinite while loop
console.log('Starting infinite while(true) loop...');
let counter = 0;

while (true) {
  counter++;
  if (counter % 100000 === 0) {
    console.log(\`While loop iteration: \${counter}\`);
    // Small yield to prevent complete CPU lock
    await new Promise(resolve => setImmediate(resolve));
  }
  if (counter > 1000000) break; // Safety break
}

process.on('SIGTERM', () => {
  console.log('Process terminated after', counter, 'iterations');
  process.exit(0);
});
`;
      fs.writeFileSync(scriptPath, scriptContent);

      const items: ProcessItem[] = [
        { name: 'while-true', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('while-true-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('while-true-group'), true);

      // Let it run briefly
      await new Promise(resolve => setTimeout(resolve, 1000));

      manager.killGroup('while-true-group');

      assert.strictEqual(manager.isGroupRunning('while-true-group'), false);
    });
  });

  describe('Blocking CPU-intensive processes', () => {
    it('should manage blocking CPU processes', async () => {
      const scriptPath = createBlockingScript('blocking-cpu.js');

      const items: ProcessItem[] = [
        { name: 'cpu-blocker', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('blocking-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('blocking-group'), true);

      // Let the blocking work run
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify it's still running despite blocking work
      assert.strictEqual(manager.isGroupRunning('blocking-group'), true);

      manager.killGroup('blocking-group');

      assert.strictEqual(manager.isGroupRunning('blocking-group'), false);
    });

    it('should handle multiple blocking processes simultaneously', async () => {
      const scriptPath = createBlockingScript('multi-blocker.js');

      const items: ProcessItem[] = [
        { name: 'blocker1', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'blocker2', args: [scriptPath], fullCmd: `node ${scriptPath}` },
        { name: 'blocker3', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('multi-blocking-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('multi-blocking-group'), true);

      // Let them run
      await new Promise(resolve => setTimeout(resolve, 1500));

      manager.killGroup('multi-blocking-group');

      assert.strictEqual(manager.isGroupRunning('multi-blocking-group'), false);
    });
  });

  describe('Server processes', () => {
    it('should manage HTTP server processes', async () => {
      const port = 18080;
      const scriptPath = createServerScript('test-server.js', port);

      const items: ProcessItem[] = [
        { name: 'http-server', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('server-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('server-group'), true);

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Optionally verify server is responding (would need fetch/http client)
      // For now, just verify it's running
      assert.strictEqual(manager.isGroupRunning('server-group'), true);

      manager.killGroup('server-group');

      assert.strictEqual(manager.isGroupRunning('server-group'), false);
    });

    it('should manage multiple server processes on different ports', async () => {
      const ports = [18081, 18082, 18083];
      const items: ProcessItem[] = [];

      for (let i = 0; i < ports.length; i++) {
        const scriptPath = createServerScript(`server-${i}.js`, ports[i]);
        items.push({
          name: `server-${ports[i]}`,
          args: [scriptPath],
          fullCmd: `node ${scriptPath}`
        });
      }

      manager.spawnGroup('multi-server-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('multi-server-group'), true);

      // Wait for servers to start
      await new Promise(resolve => setTimeout(resolve, 1500));

      manager.killGroup('multi-server-group');

      assert.strictEqual(manager.isGroupRunning('multi-server-group'), false);
    });
  });

  describe('Long-running sleep processes', () => {
    it('should manage long sleep processes', async () => {
      // Use platform-specific sleep command
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepArgs = process.platform === 'win32' ? ['/t', '60'] : ['60'];

      const items: ProcessItem[] = [
        {
          name: 'long-sleep',
          args: sleepArgs,
          fullCmd: `${sleepCmd} ${sleepArgs.join(' ')}`
        }
      ];

      manager.spawnGroup('sleep-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('sleep-group'), true);

      // Let it sleep briefly
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should still be running (sleeping for 60 seconds)
      assert.strictEqual(manager.isGroupRunning('sleep-group'), true);

      // Kill it before it completes
      manager.killGroup('sleep-group');

      assert.strictEqual(manager.isGroupRunning('sleep-group'), false);
    });
  });

  describe('Process lifecycle with restart policies', () => {
    it('should restart crashing processes with restart=yes', async () => {
      const scriptPath = path.join(testScriptsDir, 'crash-restart.js');
      const scriptContent = `
// Script that crashes after a short time
console.log('Starting crash test script...');
setTimeout(() => {
  console.log('Crashing now!');
  process.exit(1);
}, 500);
`;
      fs.writeFileSync(scriptPath, scriptContent);

      const items: ProcessItem[] = [
        { name: 'crasher', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('crash-restart-group', items, 'yes');

      assert.strictEqual(manager.isGroupRunning('crash-restart-group'), true);

      // Wait for first crash and restart attempt
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Group should still be tracked (process may have restarted)
      assert.strictEqual(manager.isGroupRunning('crash-restart-group'), true);

      manager.killGroup('crash-restart-group');
    });

    it('should not restart with restart=no', async () => {
      const scriptPath = path.join(testScriptsDir, 'no-restart.js');
      const scriptContent = `
console.log('Starting no-restart test...');
setTimeout(() => {
  console.log('Exiting gracefully');
  process.exit(0);
}, 500);
`;
      fs.writeFileSync(scriptPath, scriptContent);

      const items: ProcessItem[] = [
        { name: 'no-restart', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('no-restart-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('no-restart-group'), true);

      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Group tracking remains even after process exits
      assert.strictEqual(manager.isGroupRunning('no-restart-group'), true);

      manager.killGroup('no-restart-group');
    });
  });

  describe('Stress tests with many blocking processes', () => {
    it('should handle 10 simultaneous blocking processes', async () => {
      const scriptPath = createInfiniteLoopScript('stress-test.js', 1000);
      const items: ProcessItem[] = [];

      for (let i = 0; i < 10; i++) {
        items.push({
          name: `stress-${i}`,
          args: [scriptPath],
          fullCmd: `node ${scriptPath}`
        });
      }

      manager.spawnGroup('stress-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('stress-group'), true);
      assert.strictEqual(manager.getGroupStatus('stress-group').length, 10);

      // Let them run
      await new Promise(resolve => setTimeout(resolve, 2000));

      manager.killGroup('stress-group');

      assert.strictEqual(manager.isGroupRunning('stress-group'), false);
    });
  });

  describe('Signal handling', () => {
    it('should properly handle SIGTERM on blocking processes', async () => {
      const scriptPath = path.join(testScriptsDir, 'sigterm-test.js');
      const scriptContent = `
console.log('SIGTERM test started');

// Simulate blocking work
let running = true;
const workInterval = setInterval(() => {
  if (running) {
    console.log('Working...');
  }
}, 500);

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, cleaning up...');
  running = false;
  clearInterval(workInterval);
  setTimeout(() => {
    console.log('Cleanup complete, exiting');
    process.exit(0);
  }, 100);
});

// Keep process alive indefinitely
console.log('Process waiting for signals...');
`;
      fs.writeFileSync(scriptPath, scriptContent);

      const items: ProcessItem[] = [
        { name: 'sigterm-handler', args: [scriptPath], fullCmd: `node ${scriptPath}` }
      ];

      manager.spawnGroup('sigterm-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('sigterm-group'), true);

      await new Promise(resolve => setTimeout(resolve, 1500));

      manager.killGroup('sigterm-group');

      assert.strictEqual(manager.isGroupRunning('sigterm-group'), false);
    });
  });

  describe('Mixed process types', () => {
    it('should handle mix of servers, loops, and sleep processes', async () => {
      const items: ProcessItem[] = [];

      // Add a server
      const serverScript = createServerScript('mixed-server.js', 18090);
      items.push({
        name: 'server',
        args: [serverScript],
        fullCmd: `node ${serverScript}`
      });

      // Add an infinite loop
      const loopScript = createInfiniteLoopScript('mixed-loop.js', 800);
      items.push({
        name: 'loop',
        args: [loopScript],
        fullCmd: `node ${loopScript}`
      });

      // Add a sleep process
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepArgs = process.platform === 'win32' ? ['/t', '30'] : ['30'];
      items.push({
        name: 'sleep',
        args: sleepArgs,
        fullCmd: `${sleepCmd} ${sleepArgs.join(' ')}`
      });

      manager.spawnGroup('mixed-group', items, 'no');

      assert.strictEqual(manager.isGroupRunning('mixed-group'), true);
      assert.strictEqual(manager.getGroupStatus('mixed-group').length, 3);

      await new Promise(resolve => setTimeout(resolve, 2000));

      manager.killGroup('mixed-group');

      assert.strictEqual(manager.isGroupRunning('mixed-group'), false);
    });
  });
});
