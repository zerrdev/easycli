# Config Hot-Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--watch` flag to `cligr <group>` that watches `.cligr.yml` for changes and auto-restarts the group's processes.

**Architecture:** A new `Supervisor` class wraps `ProcessManager` and `ConfigLoader`, adding `fs.watch`-based file watching with 1s debounce. On config change, it kills the running group, reloads config, and respawns. CLI parsing in `index.ts` strips `--watch` and passes it to `upCommand`.

**Tech Stack:** Node.js built-in `fs.watch`, existing ProcessManager/ConfigLoader/TemplateExpander.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/process/supervisor.ts` | Create | Supervisor class — file watching + reload orchestration |
| `src/config/loader.ts` | Modify | Add `getConfigPath()` getter |
| `src/commands/up.ts` | Modify | Accept `options` param, use Supervisor when `--watch` |
| `src/index.ts` | Modify | Parse `--watch` flag, strip from args, pass to upCommand |
| `tests/integration/supervisor.test.ts` | Create | Integration tests for Supervisor |

---

### Task 1: Add `getConfigPath()` to ConfigLoader

**Files:**
- Modify: `src/config/loader.ts:17` (add getter)

- [ ] **Step 1: Add the getter method**

In `src/config/loader.ts`, add a public getter after the constructor (after line 37):

```ts
getConfigPath(): string {
  return this.configPath;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: expose config path via getConfigPath()"
```

---

### Task 2: Create the Supervisor class

**Files:**
- Create: `src/process/supervisor.ts`

- [ ] **Step 1: Create `src/process/supervisor.ts`**

```ts
import fs from 'fs';
import { ConfigLoader, ConfigError } from '../config/loader.js';
import { TemplateExpander } from './template.js';
import { ProcessManager } from './manager.js';
import type { GroupConfig } from '../config/types.js';

export class Supervisor {
  private processManager: ProcessManager;
  private configLoader: ConfigLoader;
  private groupName: string;
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private restarting = false;
  private readonly debounceMs = 1000;

  constructor(
    processManager: ProcessManager,
    configLoader: ConfigLoader,
    groupName: string
  ) {
    this.processManager = processManager;
    this.configLoader = configLoader;
    this.groupName = groupName;
    this.configPath = configLoader.getConfigPath();
  }

  start(): void {
    const { config, items, tool, toolTemplate, params, restart } =
      this.configLoader.getGroup(this.groupName);

    const processItems = items.map((item, index) =>
      TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
    );

    this.processManager.spawnGroup(this.groupName, processItems, restart);
    console.log(`[watch] Watching ${this.configPath} for changes...`);

    this.watcher = fs.watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        this.handleFileChange();
      }
    });
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    await this.processManager.killAll();
  }

  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reload();
    }, this.debounceMs);
  }

  private async reload(): Promise<void> {
    if (this.restarting) {
      return;
    }
    this.restarting = true;

    try {
      console.log('[watch] Config changed, restarting group...');

      await this.processManager.killGroup(this.groupName);

      let retryCount = 0;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          const { items, tool, toolTemplate, params, restart } =
            this.configLoader.getGroup(this.groupName);

          const processItems = items.map((item, index) =>
            TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
          );

          this.processManager.spawnGroup(this.groupName, processItems, restart);
          console.log('[watch] Group restarted');
          return;
        } catch (err) {
          if (err instanceof ConfigError) {
            console.error(`[watch] Config error: ${err.message}. Keeping current processes running.`);
            return;
          }

          retryCount++;
          if (retryCount <= maxRetries) {
            console.error(`[watch] Restart failed: ${(err as Error).message}. Retrying in 3s...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            console.error(`[watch] Restart failed: ${(err as Error).message}. Keeping watching.`);
          }
        }
      }
    } finally {
      this.restarting = false;
    }
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/process/supervisor.ts
git commit -m "feat: add Supervisor class for config hot-reload"
```

---

### Task 3: Update `upCommand` to accept watch option

**Files:**
- Modify: `src/commands/up.ts`

- [ ] **Step 1: Update upCommand signature and add watch support**

Replace the entire contents of `src/commands/up.ts` with:

```ts
import { ConfigLoader } from '../config/loader.js';
import { TemplateExpander } from '../process/template.js';
import { ProcessManager } from '../process/manager.js';
import { PidStore } from '../process/pid-store.js';
import { Supervisor } from '../process/supervisor.js';

export interface UpOptions {
  watch?: boolean;
}

export async function upCommand(groupName: string, options?: UpOptions): Promise<number> {
  const loader = new ConfigLoader();
  const manager = new ProcessManager();
  const pidStore = new PidStore();

  try {
    // Clean up any stale PID files for this group on startup
    await pidStore.cleanupStalePids();

    if (options?.watch) {
      const supervisor = new Supervisor(manager, loader, groupName);

      supervisor.start();
      console.log(`Started group ${groupName} (watch mode)`);
      console.log('Press Ctrl+C to stop...');

      return new Promise((resolve) => {
        const cleanup = async () => {
          console.log('\nShutting down...');
          process.removeListener('SIGINT', cleanup);
          process.removeListener('SIGTERM', cleanup);
          await supervisor.stop();
          resolve(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      });
    }

    // Default (non-watch) behavior
    const { config, items, tool, toolTemplate, params, restart } = loader.getGroup(groupName);

    // Build process items
    const processItems = items.map((item, index) =>
      TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
    );

    // Spawn all processes
    manager.spawnGroup(groupName, processItems, restart);

    console.log(`Started group ${groupName} with ${processItems.length} process(es)`);
    console.log('Press Ctrl+C to stop...');

    // Wait for signals
    return new Promise((resolve) => {
      const cleanup = async () => {
        console.log('\nShutting down...');
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        await manager.killAll();
        resolve(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ConfigError') {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/commands/up.ts
git commit -m "feat: add --watch support to upCommand"
```

---

### Task 4: Update CLI arg parsing in `index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update the else branch (group shorthand) to parse --watch**

In `src/index.ts`, update the `else` block (around line 70) that handles `cligr <group>` shorthand. Replace lines 70-74:

```ts
  } else {
    // Treat as a group name - run up command
    const exitCode = await upCommand(firstArg);
    process.exit(exitCode);
  }
```

With:

```ts
  } else {
    // Treat as a group name - run up command
    const watchIndex = rest.indexOf('--watch');
    const watch = watchIndex !== -1;
    if (watch) {
      rest.splice(watchIndex, 1);
    }

    const exitCode = await upCommand(firstArg, { watch });
    process.exit(exitCode);
  }
```

- [ ] **Step 2: Update the usage text**

In the `printUsage()` function, update the examples section to include `--watch`:

Replace:
```
Examples:
  cligr test1         Start all processes in test1 group
```

With:
```
Examples:
  cligr test1         Start all processes in test1 group
  cligr test1 --watch Start with config hot-reload
```

Also add an Options section if not present, after the existing options:

```
  --watch             Watch config file for changes and auto-restart
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run existing tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat: parse --watch flag in CLI entry point"
```

---

### Task 5: Add integration tests for Supervisor

**Files:**
- Create: `tests/integration/supervisor.test.ts`

- [ ] **Step 1: Create the test file**

```ts
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

  after(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    os.homedir = () => originalHomeDir;

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
    tool: echo
    restart: no
    items:
      hello: hello
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'watch-test');

      resetOutput();
      supervisor.start();

      assert.strictEqual(manager.isGroupRunning('watch-test'), true);
      assert.ok(getLogOutput().includes('Watching'));

      await supervisor.stop();
    });
  });

  describe('stop()', () => {
    it('should close watcher and kill all processes', { timeout: 5000 }, async () => {
      const configContent = `
groups:
  stop-test:
    tool: echo
    restart: no
    items:
      hello: hello
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'stop-test');

      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('stop-test'), true);

      await supervisor.stop();
      assert.strictEqual(manager.isGroupRunning('stop-test'), false);
    });
  });

  describe('config change reload', () => {
    it('should restart group when config file changes', { timeout: 10000 }, async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const configContent = `
groups:
  reload-test:
    tool: echo
    restart: no
    items:
      svc: ${sleepCmd},${sleepFlag},10
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'reload-test');

      resetOutput();
      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('reload-test'), true);

      // Wait for processes to fully start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Modify config
      const updatedConfig = `
groups:
  reload-test:
    tool: echo
    restart: no
    items:
      svc: ${sleepCmd},${sleepFlag},10
      new: ${sleepCmd},${sleepFlag},10
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

    it('should keep processes running on invalid config', { timeout: 10000 }, async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const configContent = `
groups:
  error-test:
    tool: echo
    restart: no
    items:
      svc: ${sleepCmd},${sleepFlag},10
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'error-test');

      resetOutput();
      supervisor.start();
      assert.strictEqual(manager.isGroupRunning('error-test'), true);

      await new Promise(resolve => setTimeout(resolve, 500));

      // Write invalid config
      resetOutput();
      fs.writeFileSync(testConfigPath, 'invalid: yaml: [');

      await new Promise(resolve => setTimeout(resolve, 3000));

      assert.ok(getErrorOutput().includes('Config error'), `Expected "Config error" in: ${getErrorOutput()}`);
      assert.strictEqual(manager.isGroupRunning('error-test'), true);

      await supervisor.stop();
    });
  });

  describe('debounce', () => {
    it('should only trigger one reload for rapid file changes', { timeout: 10000 }, async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const configContent = `
groups:
  debounce-test:
    tool: echo
    restart: no
    items:
      svc: ${sleepCmd},${sleepFlag},10
`;
      fs.writeFileSync(testConfigPath, configContent);

      const manager = new ProcessManager();
      const loader = new ConfigLoader();
      const supervisor = new Supervisor(manager, loader, 'debounce-test');

      resetOutput();
      supervisor.start();

      await new Promise(resolve => setTimeout(resolve, 500));

      // Rapid file changes
      resetOutput();
      for (let i = 0; i < 5; i++) {
        const config = `
groups:
  debounce-test:
    tool: echo
    restart: no
    items:
      svc: ${sleepCmd},${sleepFlag},10
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
    tool: echo
    restart: no
    items:
      test: test
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      assert.strictEqual(loader.getConfigPath(), testConfigPath);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: All tests pass (including new supervisor tests)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/supervisor.test.ts
git commit -m "test: add integration tests for Supervisor hot-reload"
```

---

### Task 6: Build and manual smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 2: Verify the CLI flag works**

Run: `node dist/index.js --help` (or just `node dist/index.js` with no args to see usage)
Expected: Usage text shows `--watch` option

- [ ] **Step 3: Final typecheck**

Run: `npx tsc --noEmit`
Expected: No errors
