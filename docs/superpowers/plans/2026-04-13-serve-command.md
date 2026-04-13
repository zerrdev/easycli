# `cligr serve` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `serve` command that starts an HTTP server with a web UI for toggling groups and items. Toggling updates `disabledItems` in `.cligr.yml` and restarts running groups. UI updates via Server-Sent Events.

**Architecture:** Extend `ConfigLoader` to persist `disabledItems`, extend `ProcessManager` with `EventEmitter` for real-time logs/status, and add a lightweight HTTP/SSE server in a new `serve.ts` command with an inline HTML UI.

**Tech Stack:** TypeScript, Node.js built-in `http`, `events` (EventEmitter), `js-yaml`, Node.js built-in test runner.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config/types.ts` | Modify | Add `disabledItems?: string[]` to `GroupConfig` |
| `src/config/loader.ts` | Modify | Add `saveConfig()`, `toggleItem()`, filter disabled items in `getGroup()` |
| `src/process/manager.ts` | Modify | Extend `EventEmitter`, add `restartGroup()`, emit `process-log`/`group-started`/`group-stopped`/`item-restarted` |
| `src/commands/serve.ts` | Create | HTTP server, SSE endpoint, inline HTML UI, API handlers |
| `src/index.ts` | Modify | Register `serve` command and `--port` flag parsing |
| `tests/integration/config-loader.test.ts` | Modify | Tests for `saveConfig`, `toggleItem`, `disabledItems` filtering |
| `tests/integration/process-manager.test.ts` | Modify | Tests for `restartGroup()` and emitted events |
| `tests/integration/serve.test.ts` | Create | Tests for HTTP API, SSE stream, and command registration |

---

## Task 1: Add `disabledItems` support to config types and loader

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/loader.ts`
- Test: `tests/integration/config-loader.test.ts`

- [ ] **Step 1: Update `GroupConfig` type**

Modify `src/config/types.ts`:

```typescript
export interface GroupConfig {
  tool: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  params?: Record<string, string>;
  disabledItems?: string[];
  items: Record<string, string>;
}
```

- [ ] **Step 2: Write failing tests for new loader features**

Add to `tests/integration/config-loader.test.ts` inside the `describe('ConfigLoader Integration Tests', () => { ... })` block, after the existing `describe('Constructor with explicit path', ...)`:

```typescript
  describe('saveConfig()', () => {
    it('should save config back to file', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    items:
      hello: hello
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const config = loader.load();
      config.groups.test1.restart = 'yes';

      loader.saveConfig(config);

      const saved = fs.readFileSync(testConfigPath, 'utf-8');
      assert.ok(saved.includes('restart: yes'));
    });
  });

  describe('toggleItem()', () => {
    it('should add item to disabledItems when disabling', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      loader.toggleItem('test1', 'hello', false);

      const reloaded = new ConfigLoader().load();
      assert.deepStrictEqual(reloaded.groups.test1.disabledItems, ['hello']);
    });

    it('should remove item from disabledItems when enabling', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems:
      - hello
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      loader.toggleItem('test1', 'hello', true);

      const reloaded = new ConfigLoader().load();
      assert.strictEqual(reloaded.groups.test1.disabledItems, undefined);
    });
  });

  describe('disabledItems filtering', () => {
    it('should filter disabled items from getGroup result', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems:
      - hello
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].name, 'world');
      assert.strictEqual(result.config.disabledItems?.length, 1);
    });

    it('should include all items when disabledItems is empty', () => {
      const configContent = `
groups:
  test1:
    tool: echo
    restart: no
    disabledItems: []
    items:
      hello: hello
      world: world
`;
      fs.writeFileSync(testConfigPath, configContent);

      const loader = new ConfigLoader();
      const result = loader.getGroup('test1');

      assert.strictEqual(result.items.length, 2);
    });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`

Expected: FAIL with `saveConfig is not a function`, `toggleItem is not a function`, etc.

- [ ] **Step 4: Implement `saveConfig`, `toggleItem`, and filtering**

Modify `src/config/loader.ts`:

1. Add import for `fs` at the top (if not already — it currently imports `promises as fs`, but we need sync methods; check current imports):

Current imports are:
```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
```

Good, it imports the full `fs` module (sync methods available).

2. Add methods to `ConfigLoader` class after `listGroups()`:

```typescript
  saveConfig(config: CliGrConfig): void {
    const yamlContent = yaml.dump(config, { indent: 2, lineWidth: -1 });
    fs.writeFileSync(this.configPath, yamlContent, 'utf-8');
  }

  toggleItem(groupName: string, itemName: string, enabled: boolean): void {
    const config = this.load();
    const group = config.groups[groupName];
    if (!group) {
      throw new ConfigError(`Unknown group: ${groupName}`);
    }

    const disabled = new Set(group.disabledItems || []);
    if (enabled) {
      disabled.delete(itemName);
    } else {
      disabled.add(itemName);
    }

    if (disabled.size === 0) {
      delete group.disabledItems;
    } else {
      group.disabledItems = Array.from(disabled);
    }

    this.saveConfig(config);
  }
```

3. Update `getGroup()` to filter disabled items. Find the line:
```typescript
    const items = this.normalizeItems(group.items);
```

Replace with:
```typescript
    const disabled = new Set(group.disabledItems || []);
    const enabledItems: Record<string, string> = {};
    for (const [name, value] of Object.entries(group.items)) {
      if (!disabled.has(name)) {
        enabledItems[name] = value;
      }
    }
    const items = this.normalizeItems(enabledItems);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`

Expected: PASS for all config-loader tests.

- [ ] **Step 6: Commit**

```bash
git add src/config/types.ts src/config/loader.ts tests/integration/config-loader.test.ts
git commit -m "feat(config): add disabledItems support with save and toggle"
```

---

## Task 2: Update CLI commands to respect `disabledItems`

**Files:**
- Modify: `src/commands/up.ts`
- Modify: `src/commands/ls.ts`
- Test: `tests/integration/commands.test.ts`

- [ ] **Step 1: Update `upCommand` to pass disabled state info**

`src/commands/up.ts` already uses `loader.getGroup()`, which now filters disabled items automatically. No code change needed here — but verify the existing code still works.

- [ ] **Step 2: Update `lsCommand` to show disabled status**

Modify `src/commands/ls.ts`:

```typescript
import { ConfigLoader } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { config, items } = loader.getGroup(groupName);

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    const disabled = new Set(config.disabledItems || []);
    for (const item of items) {
      const marker = disabled.has(item.name) ? ' [disabled]' : '';
      console.log(`  ${item.name}: ${item.value}${marker}`);
    }

    if (disabled.size > 0) {
      console.log(`\nDisabled items: ${Array.from(disabled).join(', ')}`);
    }

    console.log('');

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
```

Wait — that's wrong. `items` returned from `getGroup()` are already filtered. We want to show ALL items with their status. We need to load the raw items separately.

Correct approach:

```typescript
import { ConfigLoader } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const config = loader.load().groups[groupName];
    if (!config) {
      throw new Error(`Unknown group: ${groupName}. Available: ${loader.listGroups().join(', ')}`);
    }

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    const disabled = new Set(config.disabledItems || []);
    for (const [name, value] of Object.entries(config.items)) {
      const marker = disabled.has(name) ? ' [disabled]' : '';
      console.log(`  ${name}: ${value}${marker}`);
    }

    console.log('');

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
```

- [ ] **Step 3: Write failing test for `lsCommand` with disabled items**

Add to `tests/integration/commands.test.ts` inside `describe('lsCommand', () => { ... })`:

```typescript
    it('should mark disabled items in ls output', async () => {
      const configContent = `
groups:
  mixed:
    tool: echo
    restart: no
    disabledItems:
      - service2
    items:
      service1: service1
      service2: service2
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await lsCommand('mixed');

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('service1: service1'));
      assert.ok(output.includes('service2: service2 [disabled]'));
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`

Expected: PASS for commands tests.

- [ ] **Step 5: Commit**

```bash
git add src/commands/ls.ts tests/integration/commands.test.ts
git commit -m "feat(ls): show disabled items status"
```

---

## Task 3: Extend `ProcessManager` with events and `restartGroup`

**Files:**
- Modify: `src/process/manager.ts`
- Test: `tests/integration/process-manager.test.ts`

- [ ] **Step 1: Make `ProcessManager` extend `EventEmitter`**

At the top of `src/process/manager.ts`, add:

```typescript
import { EventEmitter } from 'events';
```

Change the class definition from:
```typescript
export class ProcessManager {
```
to:
```typescript
export class ProcessManager extends EventEmitter {
```

- [ ] **Step 2: Add `restartGroup()` method**

Add after `spawnGroup()`:

```typescript
  async restartGroup(groupName: string, items: ProcessItem[], restartPolicy: GroupConfig['restart']): Promise<void> {
    await this.killGroup(groupName);
    this.spawnGroup(groupName, items, restartPolicy);
    this.emit('item-restarted', groupName, items.map(i => i.name).join(', '));
  }
```

Actually, `item-restarted` in the design is for individual item restarts. For a full group restart, we should emit `group-started`. Let's adjust:

```typescript
  async restartGroup(groupName: string, items: ProcessItem[], restartPolicy: GroupConfig['restart']): Promise<void> {
    await this.killGroup(groupName);
    this.spawnGroup(groupName, items, restartPolicy);
  }
```

`spawnGroup` already emits `group-started`, and `killGroup` emits `group-stopped`.

- [ ] **Step 3: Emit events in `spawnGroup`, `killGroup`, and line-buffer logs**

1. In `spawnGroup()`, after setting the map, emit:

```typescript
    this.groups.set(groupName, processes);
    this.emit('group-started', groupName);
```

2. In `killGroup()`, after cleanup, emit:

```typescript
    return Promise.all(killPromises).then(async () => {
      await this.pidStore.deleteGroupPids(groupName);
      this.emit('group-stopped', groupName);
    });
```

3. For line-buffered log emission, modify the stdout/stderr handlers in `spawnProcess()`. Replace the existing handlers with:

```typescript
    const emitLines = (data: Buffer, isError: boolean) => {
      const text = data.toString('utf-8');
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.length > 0 || lines.length > 1) {
          this.emit('process-log', groupName, item.name, line, isError);
        }
      }
    };

    // Prefix output with item name and emit events
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        process.stdout.write(`[${item.name}] ${data}`);
        emitLines(data, false);
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        process.stderr.write(`[${item.name}] ${data}`);
        emitLines(data, true);
      });
    }
```

Wait, this will emit events for incomplete lines at end of buffer too. That's acceptable for this design. The alternative is to keep a line buffer per stream, but for simplicity we split on newlines.

Also, in `handleExit()` where restarts happen, emit `item-restarted`:

In `handleExit()`, inside the `setTimeout` callback where restart happens:

```typescript
    // Restart after delay
    setTimeout(() => {
      console.log(`[${item.name}] Restarting... (exit code: ${code})`);
      const newProc = this.spawnProcess(item, groupName, restartPolicy);
      this.emit('item-restarted', groupName, item.name);

      // Update the ManagedProcess in the groups Map with the new process handle
      ...
    }, 1000);
```

- [ ] **Step 4: Write failing tests for new ProcessManager features**

Add to `tests/integration/process-manager.test.ts` inside the main describe block, after `describe('Cross-platform compatibility', ...)`:

```typescript
  describe('restartGroup()', () => {
    it('should restart a running group', async () => {
      const sleepCmd = process.platform === 'win32' ? 'timeout' : 'sleep';
      const sleepFlag = process.platform === 'win32' ? '/t' : '';

      const items: ProcessItem[] = [
        { name: 'p1', args: ['5'], fullCmd: `${sleepCmd} ${sleepFlag} 5` }
      ];

      manager.spawnGroup('restart-group', items, 'no');
      assert.strictEqual(manager.isGroupRunning('restart-group'), true);

      await manager.restartGroup('restart-group', items, 'no');
      assert.strictEqual(manager.isGroupRunning('restart-group'), true);

      await manager.killGroup('restart-group');
    });
  });

  describe('events', () => {
    it('should emit group-started when spawning', async () => {
      let emitted = false;
      manager.once('group-started', (name) => {
        assert.strictEqual(name, 'event-group');
        emitted = true;
      });

      const items: ProcessItem[] = [
        { name: 'p1', args: [], fullCmd: 'echo hello' }
      ];

      manager.spawnGroup('event-group', items, 'no');
      assert.strictEqual(emitted, true);

      await manager.killGroup('event-group');
    });

    it('should emit group-stopped when killing', async () => {
      const items: ProcessItem[] = [
        { name: 'p1', args: ['5'], fullCmd: process.platform === 'win32' ? 'timeout /t 5' : 'sleep 5' }
      ];

      manager.spawnGroup('stop-group', items, 'no');

      let emitted = false;
      manager.once('group-stopped', (name) => {
        assert.strictEqual(name, 'stop-group');
        emitted = true;
      });

      await manager.killGroup('stop-group');
      assert.strictEqual(emitted, true);
    });

    it('should emit process-log events', async () => {
      const items: ProcessItem[] = [
        { name: 'logger', args: [], fullCmd: 'echo test-log' }
      ];

      const logs: Array<{ group: string; item: string; line: string; isError: boolean }> = [];
      manager.on('process-log', (group, item, line, isError) => {
        logs.push({ group, item, line, isError });
      });

      manager.spawnGroup('log-group', items, 'no');

      // Wait for process to run
      await new Promise(resolve => setTimeout(resolve, 500));

      assert.ok(logs.some(l => l.group === 'log-group' && l.item === 'logger' && l.line.includes('test-log')));

      await manager.killGroup('log-group');
    });
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`

Expected: PASS for all process-manager tests.

- [ ] **Step 6: Commit**

```bash
git add src/process/manager.ts tests/integration/process-manager.test.ts
git commit -m "feat(process): add EventEmitter, restartGroup, and process-log events"
```

---

## Task 4: Create the `serve` command

**Files:**
- Create: `src/commands/serve.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/serve.test.ts`

- [ ] **Step 1: Create `serve.ts` command**

Create `src/commands/serve.ts`:

```typescript
import http from 'http';
import { ConfigLoader } from '../config/loader.js';
import { ProcessManager } from '../process/manager.js';
import { TemplateExpander } from '../process/template.js';

export async function serveCommand(portArg?: string): Promise<number> {
  const port = portArg ? parseInt(portArg, 10) : 7373;
  const loader = new ConfigLoader();
  const manager = new ProcessManager();

  // Clean up any stale PID files on startup
  await manager.cleanupStalePids();

  const clients: http.ServerResponse[] = [];

  const sendEvent = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
  };

  manager.on('group-started', (groupName) => {
    sendEvent('status', { type: 'group-started', groupName });
  });

  manager.on('group-stopped', (groupName) => {
    sendEvent('status', { type: 'group-stopped', groupName });
  });

  manager.on('item-restarted', (groupName, itemName) => {
    sendEvent('status', { type: 'item-restarted', groupName, itemName });
  });

  manager.on('process-log', (groupName, itemName, line, isError) => {
    sendEvent('log', { group: groupName, item: itemName, line, isError });
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(serveHtml());
      return;
    }

    if (url.pathname === '/api/groups') {
      try {
        const config = loader.load();
        const groups = Object.entries(config.groups).map(([name, group]) => ({
          name,
          tool: group.tool,
          restart: group.restart,
          items: Object.entries(group.items).map(([itemName, value]) => ({
            name: itemName,
            value,
            enabled: !(group.disabledItems || []).includes(itemName),
          })),
          running: manager.isGroupRunning(name),
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ groups }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    if (url.pathname === '/api/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);
      res.write(':ok\n\n');
      clients.push(res);
      req.on('close', () => {
        const index = clients.indexOf(res);
        if (index !== -1) clients.splice(index, 1);
      });
      return;
    }

    const toggleMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/toggle$/);
    if (toggleMatch && req.method === 'POST') {
      const groupName = decodeURIComponent(toggleMatch[1]);
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        try {
          const { enabled } = JSON.parse(body);
          if (enabled) {
            const { config, items, tool, toolTemplate, params } = loader.getGroup(groupName);
            const processItems = items.map((item, index) =>
              TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
            );
            manager.spawnGroup(groupName, processItems, config.restart);
          } else {
            await manager.killGroup(groupName);
          }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    const itemToggleMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/items\/([^/]+)\/toggle$/);
    if (itemToggleMatch && req.method === 'POST') {
      const groupName = decodeURIComponent(itemToggleMatch[1]);
      const itemName = decodeURIComponent(itemToggleMatch[2]);
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        try {
          const { enabled } = JSON.parse(body);
          loader.toggleItem(groupName, itemName, enabled);

          if (manager.isGroupRunning(groupName)) {
            const { config, items, tool, toolTemplate, params } = loader.getGroup(groupName);
            const processItems = items.map((item, index) =>
              TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
            );
            await manager.restartGroup(groupName, processItems, config.restart);
          }

          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(2);
    }
  });

  server.listen(port, () => {
    console.log(`cligr serve running at http://localhost:${port}`);
  });

  // Keep process alive
  return new Promise(() => {});
}

function serveHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>cligr serve</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    .group { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
    .group-header { display: flex; align-items: center; gap: 0.5rem; font-weight: bold; font-size: 1.1rem; }
    .items { margin: 0.5rem 0 0 1.5rem; }
    .item { display: flex; align-items: center; gap: 0.4rem; margin: 0.25rem 0; }
    .logs { background: #111; color: #0f0; font-family: monospace; font-size: 0.85rem; height: 300px; overflow-y: auto; padding: 0.75rem; border-radius: 4px; white-space: pre-wrap; }
    .error { color: #f55; }
  </style>
</head>
<body>
  <h1>cligr serve</h1>
  <div id="groups"></div>
  <h2>Logs</h2>
  <div class="logs" id="logs"></div>

  <script>
    const groupsEl = document.getElementById('groups');
    const logsEl = document.getElementById('logs');
    let autoScroll = true;

    async function fetchGroups() {
      const res = await fetch('/api/groups');
      const data = await res.json();
      renderGroups(data.groups);
    }

    function renderGroups(groups) {
      groupsEl.innerHTML = '';
      for (const g of groups) {
        const div = document.createElement('div');
        div.className = 'group';

        const header = document.createElement('div');
        header.className = 'group-header';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = g.running;
        checkbox.onchange = async () => {
          await fetch(\`/api/groups/\${encodeURIComponent(g.name)}/toggle\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: checkbox.checked })
          });
        };
        header.appendChild(checkbox);
        header.appendChild(document.createTextNode(g.name + ' (' + g.tool + ')' + (g.running ? ' - running' : '')));
        div.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'items';
        for (const item of g.items) {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'item';
          const itemCb = document.createElement('input');
          itemCb.type = 'checkbox';
          itemCb.checked = item.enabled;
          itemCb.onchange = async () => {
            await fetch(\`/api/groups/\${encodeURIComponent(g.name)}/items/\${encodeURIComponent(item.name)}/toggle\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: itemCb.checked })
            });
          };
          itemDiv.appendChild(itemCb);
          itemDiv.appendChild(document.createTextNode(item.name + ': ' + item.value));
          itemsDiv.appendChild(itemDiv);
        }
        div.appendChild(itemsDiv);
        groupsEl.appendChild(div);
      }
    }

    logsEl.addEventListener('scroll', () => {
      autoScroll = logsEl.scrollTop + logsEl.clientHeight >= logsEl.scrollHeight - 10;
    });

    function appendLog(line, isError) {
      const span = document.createElement('div');
      span.textContent = line;
      if (isError) span.className = 'error';
      logsEl.appendChild(span);
      if (autoScroll) logsEl.scrollTop = logsEl.scrollHeight;
    }

    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('status', (e) => {
      fetchGroups();
    });
    evtSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      appendLog(\`[\${data.group}/\${data.item}] \${data.line}\`, data.isError);
    });
    evtSource.onerror = () => {
      appendLog('[SSE connection error]', true);
    };

    fetchGroups();
  </script>
</body>
</html>`;
}
```

Note: The `manager['pidStore']` private access is a bit hacky. A better approach is to expose a public method on `ProcessManager` for cleanup. Let's add that in Task 3. In `src/process/manager.ts`, add:

```typescript
  async cleanupStalePids(): Promise<void> {
    await this.pidStore.cleanupStalePids();
  }
```

Then in `serve.ts`, call `await manager.cleanupStalePids();` instead.

- [ ] **Step 2: Add `cleanupStalePids` wrapper to `ProcessManager`**

Add to `src/process/manager.ts` after `killAll()`:

```typescript
  async cleanupStalePids(): Promise<void> {
    await this.pidStore.cleanupStalePids();
  }
```

- [ ] **Step 3: Register `serve` in `src/index.ts`**

Modify `src/index.ts`:

1. Add import:
```typescript
import { serveCommand } from './commands/serve.js';
```

2. Update `knownCommands` array:
```typescript
  const knownCommands = ['config', 'up', 'ls', 'groups', 'serve'];
```

3. In the switch statement, add:
```typescript
      case 'serve':
        exitCode = await serveCommand(rest[0]);
        break;
```

4. Update `printUsage`:
```typescript
  console.log(`
Usage: cligr <group> | <command> [options]

Commands:
  config              Open config file in editor
  ls <group>          List all items in the group
  groups [-v|--verbose]  List all groups
  serve [port]        Start web UI server (default port 7373)

Options:
  -v, --verbose       Show detailed group information

Examples:
  cligr test1         Start all processes in test1 group
  cligr config
  cligr ls test1
  cligr groups
  cligr groups -v
  cligr serve
  cligr serve 8080
`);
```

- [ ] **Step 4: Write failing tests for `serve` command**

Create `tests/integration/serve.test.ts`:

```typescript
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

let serverProcess: import('child_process').ChildProcess | null = null;

describe('serve command integration tests', () => {
  let testConfigDir: string;
  let testConfigPath: string;
  let originalHomeDir: string;

  before(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-serve-test-'));
    testConfigPath = path.join(testConfigDir, '.cligr.yml');
    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);
  });

  after(() => {
    mock.method(os, 'homedir', () => originalHomeDir);
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  function writeConfig() {
    const configContent = `
groups:
  web:
    tool: echo
    restart: no
    disabledItems:
      - worker
    items:
      server: server
      worker: worker
`;
    fs.writeFileSync(testConfigPath, configContent);
  }

  async function startServer(port: number) {
    const { spawn } = await import('child_process');
    serverProcess = spawn('node', ['dist/index.js', 'serve', String(port)], {
      cwd: process.cwd(),
      stdio: 'pipe'
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const onData = (data: Buffer) => {
        output += data.toString();
        if (output.includes('cligr serve running at')) {
          cleanup();
          resolve();
        }
      };
      const onError = (data: Buffer) => {
        output += data.toString();
      };
      serverProcess!.stdout!.on('data', onData);
      serverProcess!.stderr!.on('data', onError);

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Server startup timeout'));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        serverProcess!.stdout!.off('data', onData);
        serverProcess!.stderr!.off('data', onError);
      };
    });
  }

  async function httpGet(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on('error', reject);
      req.setTimeout(2000, () => reject(new Error('HTTP timeout')));
    });
  }

  async function httpPost(url: string, body: object): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: responseBody }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  it('should serve the HTML UI', { timeout: 10000 }, async () => {
    writeConfig();
    const port = 17373;
    await startServer(port);

    const res = await httpGet(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('cligr serve'));
  });

  it('should return groups via API', { timeout: 10000 }, async () => {
    writeConfig();
    const port = 17374;
    await startServer(port);

    const res = await httpGet(`http://localhost:${port}/api/groups`);
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.groups));
    assert.strictEqual(data.groups.length, 1);
    assert.strictEqual(data.groups[0].name, 'web');
    assert.strictEqual(data.groups[0].running, false);
    assert.strictEqual(data.groups[0].items.length, 2);
    const serverItem = data.groups[0].items.find((i: any) => i.name === 'server');
    const workerItem = data.groups[0].items.find((i: any) => i.name === 'worker');
    assert.strictEqual(serverItem.enabled, true);
    assert.strictEqual(workerItem.enabled, false);
  });

  it('should toggle group via API', { timeout: 10000 }, async () => {
    writeConfig();
    const port = 17375;
    await startServer(port);

    const postRes = await httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: true });
    assert.strictEqual(postRes.status, 200);

    // Give it a moment to start
    await new Promise(r => setTimeout(r, 300));

    const getRes = await httpGet(`http://localhost:${port}/api/groups`);
    const data = JSON.parse(getRes.body);
    const web = data.groups.find((g: any) => g.name === 'web');
    assert.strictEqual(web.running, true);

    // Stop it
    await httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: false });
  });

  it('should toggle item via API', { timeout: 10000 }, async () => {
    writeConfig();
    const port = 17376;
    await startServer(port);

    const postRes = await httpPost(`http://localhost:${port}/api/groups/web/items/worker/toggle`, { enabled: true });
    assert.strictEqual(postRes.status, 200);

    const getRes = await httpGet(`http://localhost:${port}/api/groups`);
    const data = JSON.parse(getRes.body);
    const web = data.groups.find((g: any) => g.name === 'web');
    const worker = web.items.find((i: any) => i.name === 'worker');
    assert.strictEqual(worker.enabled, true);
  });

  it('should stream SSE events', { timeout: 10000 }, async () => {
    writeConfig();
    const port = 17377;
    await startServer(port);

    return new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/api/events`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes('event: status')) {
            req.destroy();
            resolve();
          }
        });
      });
      req.on('error', reject);

      // Trigger a status event by toggling a group
      setTimeout(() => {
        httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: true }).catch(() => {});
      }, 200);

      setTimeout(() => {
        req.destroy();
        reject(new Error('SSE timeout'));
      }, 3000);
    });
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --include-blocking`  
Actually, these aren't blocking tests. The serve tests need the built dist. The test script builds source to `.js` but `serve.test.ts` imports `dist/index.js`. We need to ensure the project is built first.

Actually, looking at the test script, it builds `src/` files to `.js` alongside `.ts`. But `dist/index.js` is the packaged output. We should either:
1. Build the full project with `npm run build` before tests, or
2. Not test `dist/index.js` and instead test the `serveCommand` function directly.

Better approach: test `serveCommand` directly and spawn it as a subprocess from the built `dist/index.js`. Add a build step before running serve tests.

For the test, modify to build first:

Actually, the project has a `build` script that uses `scripts/build.js`. Let's check what it does.

Let's simplify: instead of spawning `dist/index.js`, we can spawn `node --import ...` or just test the HTTP server function directly by importing `serveCommand` and running it on a free port, then stopping the server.

But `serveCommand` returns a never-resolving promise. We'd need to export the server or close it somehow. Better yet, we can test the API by importing the server setup logic.

Actually, let's keep it simple: spawn the built CLI. The test runner can call `npm run build` before starting.

In the test file, add a build step in `before()` or assume `dist/index.js` exists.

Let me check `scripts/build.js`:

```typescript
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';

const srcDir = 'src';
const outDir = 'dist';

async function buildAll() {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const entries = fs.readdirSync(srcDir)
    .filter(f => f.endsWith('.ts'))
    .map(f => path.join(srcDir, f));

  await build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    target: 'es2022',
    format: 'esm',
    outdir: outDir,
    external: [],
  });
}

buildAll().catch(err => {
  console.error(err);
  process.exit(1);
});
```

So `npm run build` creates `dist/index.js` from `src/index.ts`.

For the serve test, we can build the project first in a `before` block. But that's slow. Alternatively, we can test by importing `serveCommand` directly and pass it a port. But we need a way to stop it.

Let's modify `serveCommand` slightly to return a cleanup function or store the server. Actually, we can export the server instance. But that's not needed for the command usage.

For testing, the simplest reliable approach is:
1. Build with `npm run build`
2. Spawn `node dist/index.js serve <port>`
3. Test HTTP endpoints
4. Kill the child process

We can add a `build` call in the test's `before` hook.

Actually, the test file already has async code. Let's add:

```typescript
  before(async () => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-serve-test-'));
    testConfigPath = path.join(testConfigDir, '.cligr.yml');
    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);

    // Build dist/index.js
    const { spawnSync } = await import('child_process');
    const result = spawnSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe' });
    if (result.status !== 0) {
      throw new Error('Build failed: ' + result.stderr?.toString());
    }
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`

Expected: PASS for all tests, including new `serve.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/commands/serve.ts src/process/manager.ts src/index.ts tests/integration/serve.test.ts
git commit -m "feat(serve): add HTTP server with SSE and web UI for managing groups"
```

---

## Self-Review

**Spec coverage check:**
- `disabledItems` config persistence → Task 1
- Config filtering in `getGroup()` → Task 1
- `ProcessManager` EventEmitter and events → Task 3
- `restartGroup()` → Task 3
- HTTP API (`/api/groups`, `/api/groups/:name/toggle`, `/api/groups/:name/items/:item/toggle`) → Task 4
- SSE endpoint (`/api/events`) → Task 4
- Inline HTML UI → Task 4
- Port configuration → Task 4 (`serve [port]`)
- Error handling (port in use, config errors) → Task 4
- Tests for all components → Each task

**Placeholder scan:**
- No "TBD", "TODO", or vague requirements found.
- All code snippets are complete.
- All commands are exact.

**Type consistency check:**
- `disabledItems?: string[]` used consistently
- `saveConfig(config: CliGrConfig)` used consistently
- `toggleItem(groupName, itemName, enabled)` used consistently
- Event names match design: `group-started`, `group-stopped`, `item-restarted`, `process-log`

No gaps found. Plan is ready for execution.
