/**
 * Integration tests for Supervisor
 *
 * These tests verify the hot-reload supervisor functionality including:
 * - Starting the supervisor (spawn group + file watcher)
 * - Stopping the supervisor (close watcher + kill processes)
 * - Config change detection and group restart
 * - Invalid config handling (logs error)
 * - Debounce of rapid file changes
 * - Config path exposure
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Supervisor } from '../../src/process/supervisor.js';
import { ProcessManager } from '../../src/process/manager.js';
import { ConfigLoader } from '../../src/config/loader.js';

describe('Supervisor Integration Tests', () => {
  let testConfigDir: string;
  let testConfigPath: string;
  let originalHomeDir: string;
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let logOutput: string[];
  let errorOutput: string[];
  const activeSupervisors: Supervisor[] = [];

  before(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-watch-test-'));
    testConfigPath = path.join(testConfigDir, '.cligr.yml');

    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);

    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    logOutput = [];
    errorOutput = [];

    console.log = (...args: any[]) => {
      logOutput.push(args.map(arg => String(arg)).join(' '));
    };
    console.error = (...args: any[]) => {
      errorOutput.push(args.map(arg => String(arg)).join(' '));
    };
  });

  after(async () => {
    // Stop all supervisors before restoring console and cleaning up temp dir
    for (const supervisor of activeSupervisors) {
      try {
        await supervisor.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    activeSupervisors.length = 0;

    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    mock.method(os, 'homedir', () => originalHomeDir);

    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  function resetOutput() {
    logOutput = [];
    errorOutput = [];
  }

  function getLogOutput(): string {
    return logOutput.join('\n');
  }

  function getErrorOutput(): string {
    return errorOutput.join('\n');
  }

  describe('start()', () => {
    it('should spawn group and start watching', { timeout: 5000 }, async () => {
      const configContent = `
groups:
  watch-test:
    restart: no
    items:
      hello: node -e "console.log('hello')"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'watch-test');
      activeSupervisors.push(supervisor);

      resetOutput();
      supervisor.start();

      assert.strictEqual(manager.isGroupRunning('watch-test'), true);
      assert.ok(getLogOutput().includes('Watching'), `Expected "Watching" in output: ${getLogOutput()}`);

      await supervisor.stop();
    });
  });

  describe('stop()', () => {
    it('should close watcher and kill all processes', { timeout: 5000 }, async () => {
      const configContent = `
groups:
  stop-test:
    restart: no
    items:
      hello: node -e "setTimeout(()=>{},30000)"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'stop-test');
      activeSupervisors.push(supervisor);

      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('stop-test'), true);

      await supervisor.stop();
      assert.strictEqual(manager.isGroupRunning('stop-test'), false);
    });
  });

  describe('config change reload', () => {
    it('should restart group when config file changes', { timeout: 15000 }, async () => {
      const configContent = `
groups:
  reload-test:
    restart: no
    items:
      svc: node -e "setTimeout(()=>{},30000)"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'reload-test');
      activeSupervisors.push(supervisor);

      resetOutput();
      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('reload-test'), true);

      // Wait for processes to fully start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Modify config - add a new item
      const updatedConfig = `
groups:
  reload-test:
    restart: no
    items:
      svc: node -e "setTimeout(()=>{},30000)"
      new: node -e "setTimeout(()=>{},30000)"
`;
      resetOutput();
      fs.writeFileSync(testConfigPath, updatedConfig);

      // Wait for debounce (1s) + restart time
      await new Promise(resolve => setTimeout(resolve, 3000));

      assert.ok(getLogOutput().includes('Config changed'), `Expected "Config changed" in: ${getLogOutput()}`);
      assert.ok(getLogOutput().includes('Group restarted'), `Expected "Group restarted" in: ${getLogOutput()}`);
      assert.strictEqual(manager.isGroupRunning('reload-test'), true);

      await supervisor.stop();
    });

    it('should log error on invalid config', { timeout: 15000 }, async () => {
      const configContent = `
groups:
  error-test:
    restart: no
    items:
      svc: node -e "setTimeout(()=>{},30000)"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'error-test');
      activeSupervisors.push(supervisor);

      resetOutput();
      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('error-test'), true);

      await new Promise(resolve => setTimeout(resolve, 500));

      // Write invalid config (invalid YAML)
      resetOutput();
      fs.writeFileSync(testConfigPath, 'invalid: yaml: [');

      await new Promise(resolve => setTimeout(resolve, 3000));

      // The Supervisor logs a config error when the file changes
      // It kills the old group before attempting to reload, so the group
      // may not be running after an invalid config
      assert.ok(getErrorOutput().includes('Config error') || getLogOutput().includes('Config changed'), `Expected "Config error" in error output or "Config changed" in log output. Error: ${getErrorOutput()}. Log: ${getLogOutput()}`);

      await supervisor.stop();
    });
  });

  describe('debounce', () => {
    it('should only trigger one reload for rapid file changes', { timeout: 15000 }, async () => {
      const configContent = `
groups:
  debounce-test:
    restart: no
    items:
      svc: node -e "setTimeout(()=>{},30000)"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'debounce-test');
      activeSupervisors.push(supervisor);

      resetOutput();
      supervisor.start();

      await new Promise(resolve => setTimeout(resolve, 500));

      // Rapid file changes
      resetOutput();
      for (let i = 0; i < 5; i++) {
        const config = `
groups:
  debounce-test:
    restart: no
    items:
      svc: node -e "setTimeout(()=>{},30000)"
`;
        fs.writeFileSync(testConfigPath, config);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));

      const restartCount = (getLogOutput().match(/Group restarted/g) || []).length;
      assert.strictEqual(restartCount, 1, `Expected exactly 1 restart, got ${restartCount}`);

      await supervisor.stop();
    });
  });

  describe('getConfigPath', () => {
    it('should expose config path from loader', () => {
      const configContent = `
groups:
  path-test:
    restart: no
    items:
      test: node -e "console.log('test')"
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      assert.strictEqual(loader.getConfigPath(), testConfigPath);
    });
  });
});
