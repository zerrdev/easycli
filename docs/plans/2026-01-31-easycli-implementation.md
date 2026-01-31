# EasyCLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript CLI tool that manages groups of concurrent processes from a YAML configuration.

**Architecture:** Single-process manager using Node.js child_process. Config-driven with template-based command expansion. Auto-restart with configurable policies.

**Tech Stack:** TypeScript, Node.js, esbuild, js-yaml

**Dependencies needed:**
- `js-yaml` - YAML parsing
- `yargs` or `cac` - CLI argument parsing (or simple manual parsing)
- `chalk` or `picocolors` - Terminal colors (optional)

---

### Task 1: Add project dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add js-yaml dependency**

```bash
npm install js-yaml
npm install --save-dev @types/js-yaml
```

**Step 2: Verify package.json**

Run: `cat package.json`
Expected: `js-yaml` in dependencies, `@types/js-yaml` in devDependencies

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add js-yaml for config parsing"
```

---

### Task 2: Create config types

**Files:**
- Create: `src/config/types.ts`

**Step 1: Write TypeScript interfaces**

```typescript
export interface ToolConfig {
  cmd: string;
}

export interface GroupConfig {
  tool: string;
  restart: 'yes' | 'no' | 'unless-stopped';
  items: string[];
}

export interface EasyCliConfig {
  tools?: Record<string, ToolConfig>;
  groups: Record<string, GroupConfig>;
}

export interface ProcessItem {
  name: string;
  args: string[];
  fullCmd: string;
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat: add config type definitions"
```

---

### Task 3: Create config loader

**Files:**
- Create: `src/config/loader.ts`

**Step 1: Write config loader**

```typescript
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { EasyCliConfig, GroupConfig, ToolConfig, ProcessItem } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConfigLoader {
  private configPath: string;

  constructor(configPath: string = 'easycli.yml') {
    this.configPath = path.resolve(configPath);
  }

  load(): EasyCliConfig {
    if (!fs.existsSync(this.configPath)) {
      throw new ConfigError(`Config file not found: ${this.configPath}`);
    }

    const content = fs.readFileSync(this.configPath, 'utf-8');
    let config: unknown;

    try {
      config = yaml.load(content);
    } catch (err) {
      throw new ConfigError(`Invalid YAML: ${(err as Error).message}`);
    }

    return this.validate(config);
  }

  private validate(config: unknown): EasyCliConfig {
    if (!config || typeof config !== 'object') {
      throw new ConfigError('Config must be an object');
    }

    const cfg = config as Record<string, unknown>;

    if (!cfg.groups || typeof cfg.groups !== 'object') {
      throw new ConfigError('Config must have a "groups" object');
    }

    return cfg as EasyCliConfig;
  }

  getGroup(name: string): { config: GroupConfig; tool: string | null; toolTemplate: string | null } {
    const config = this.load();
    const group = config.groups[name];

    if (!group) {
      const available = Object.keys(config.groups).join(', ');
      throw new ConfigError(`Unknown group: ${name}. Available: ${available}`);
    }

    // Resolve tool
    let toolTemplate: string | null = null;
    let tool: string | null = null;

    if (config.tools && config.tools[group.tool]) {
      toolTemplate = config.tools[group.tool].cmd;
      tool = group.tool;
    } else {
      // Tool might be a direct executable
      tool = null;
      toolTemplate = null;
    }

    return { config: group, tool, toolTemplate };
  }

  listGroups(): string[] {
    const config = this.load();
    return Object.keys(config.groups);
  }
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: add config loader with validation"
```

---

### Task 4: Create template expander

**Files:**
- Create: `src/process/template.ts`

**Step 1: Write template expander**

```typescript
import type { ProcessItem } from '../config/types.js';

export class TemplateExpander {
  /**
   * Expands a command template with item arguments
   * @param template - Command template with $1, $2, $3 etc.
   * @param itemStr - Comma-separated item args (e.g., "service1,8080,80")
   * @returns ProcessItem with expanded command
   */
  static expand(template: string, itemStr: string, index: number): ProcessItem {
    const args = itemStr.split(',').map(s => s.trim());

    // Generate name from first arg or use index
    const name = args[0] || `item-${index}`;

    // Replace $1, $2, $3 etc. with args
    let fullCmd = template;
    for (let i = 0; i < args.length; i++) {
      const placeholder = `$${i + 1}`;
      fullCmd = fullCmd.replaceAll(placeholder, args[i]);
    }

    return { name, args, fullCmd };
  }

  /**
   * Parses item string into command
   * @param tool - Tool name or executable
   * @param toolTemplate - Template from tools config (if registered tool)
   * @param itemStr - Comma-separated args
   * @param index - Item index in group
   */
  static parseItem(tool: string | null, toolTemplate: string | null, itemStr: string, index: number): ProcessItem {
    if (toolTemplate) {
      // Use registered tool template
      return this.expand(toolTemplate, itemStr, index);
    } else {
      // Direct executable - use tool as command prefix
      const args = itemStr.split(',').map(s => s.trim());
      const name = args[0] || `item-${index}`;
      const fullCmd = tool ? `${tool} ${itemStr}` : itemStr;
      return { name, args, fullCmd };
    }
  }
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/process/template.ts
git commit -m "feat: add template expander for command substitution"
```

---

### Task 5: Create process manager

**Files:**
- Create: `src/process/manager.ts`

**Step 1: Write process manager**

```typescript
import { spawn, ChildProcess } from 'child_process';
import type { GroupConfig, ProcessItem } from '../config/types.js';

export type ProcessStatus = 'running' | 'stopped' | 'failed';

export class ManagedProcess {
  constructor(
    public item: ProcessItem,
    public process: ChildProcess,
    public status: ProcessStatus = 'running'
  ) {}
}

export class ProcessManager {
  private groups = new Map<string, ManagedProcess[]>();
  private restartCount = new Map<string, number>();
  private readonly maxRestarts = 3;
  private readonly restartWindow = 10000; // 10 seconds

  spawnGroup(groupName: string, items: ProcessItem[], restartPolicy: GroupConfig['restart']): void {
    if (this.groups.has(groupName)) {
      throw new Error(`Group ${groupName} is already running`);
    }

    const processes: ManagedProcess[] = [];

    for (const item of items) {
      const proc = this.spawnProcess(item, groupName, restartPolicy);
      processes.push(new ManagedProcess(item, proc));
    }

    this.groups.set(groupName, processes);
  }

  private spawnProcess(item: ProcessItem, groupName: string, restartPolicy: GroupConfig['restart']): ChildProcess {
    // Parse command into executable and args
    const parts = item.fullCmd.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      stdio: ['inherit', 'pipe', 'pipe']
    });

    // Prefix output with item name
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        process.stdout.write(`[${item.name}] ${data}`);
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        process.stderr.write(`[${item.name}] ${data}`);
      });
    }

    // Handle exit and restart
    proc.on('exit', (code, signal) => {
      this.handleExit(groupName, item, restartPolicy, code, signal);
    });

    return proc;
  }

  private handleExit(groupName: string, item: ProcessItem, restartPolicy: GroupConfig['restart'], code: number | null, signal: NodeJS.Signals | null): void {
    // Check if killed by easycli (don't restart if unless-stopped)
    if (restartPolicy === 'unless-stopped' && signal === 'SIGTERM') {
      return;
    }

    // Check restart policy
    if (restartPolicy === 'no') {
      return;
    }

    // Check for crash loop
    const key = `${groupName}-${item.name}`;
    const count = (this.restartCount.get(key) || 0) + 1;
    this.restartCount.set(key, count);

    if (count > this.maxRestarts) {
      console.error(`[${item.name}] Crash loop detected. Stopping restarts.`);
      return;
    }

    // Restart after delay
    setTimeout(() => {
      console.log(`[${item.name}] Restarting... (exit code: ${code})`);
      this.spawnProcess(item, groupName, restartPolicy);
    }, 1000);
  }

  killGroup(groupName: string): void {
    const processes = this.groups.get(groupName);
    if (!processes) return;

    for (const mp of processes) {
      mp.process.kill('SIGTERM');
    }

    this.groups.delete(groupName);
  }

  killAll(): void {
    for (const groupName of this.groups.keys()) {
      this.killGroup(groupName);
    }
  }

  getGroupStatus(groupName: string): ProcessStatus[] {
    const processes = this.groups.get(groupName);
    if (!processes) return [];

    return processes.map(mp => mp.status);
  }

  isGroupRunning(groupName: string): boolean {
    return this.groups.has(groupName);
  }

  getRunningGroups(): string[] {
    return Array.from(this.groups.keys());
  }
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/process/manager.ts
git commit -m "feat: add process manager with spawn and restart logic"
```

---

### Task 6: Create up command

**Files:**
- Create: `src/commands/up.ts`

**Step 1: Write up command**

```typescript
import { ConfigLoader } from '../config/loader.js';
import { TemplateExpander } from '../process/template.js';
import { ProcessManager } from '../process/manager.js';

export async function upCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();
  const manager = new ProcessManager();

  // Load group config
  const { config, tool, toolTemplate } = loader.getGroup(groupName);

  // Build process items
  const items = config.items.map((itemStr, index) =>
    TemplateExpander.parseItem(tool, toolTemplate, itemStr, index)
  );

  // Spawn all processes
  manager.spawnGroup(groupName, items, config.restart);

  console.log(`Started group ${groupName} with ${items.length} process(es)`);
  console.log('Press Ctrl+C to stop...');

  // Wait for signals
  return new Promise((resolve) => {
    const cleanup = () => {
      console.log('\nShutting down...');
      manager.killAll();
      resolve(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/up.ts
git commit -m "feat: add up command to start process groups"
```

---

### Task 7: Create ls command

**Files:**
- Create: `src/commands/ls.ts`

**Step 1: Write ls command**

```typescript
import { ConfigLoader } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { config } = loader.getGroup(groupName);

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    for (const item of config.items) {
      const parts = item.split(',');
      const name = parts[0];
      console.log(`  - ${name} (args: ${parts.slice(1).join(', ')})`);
    }

    console.log('');

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/ls.ts
git commit -m "feat: add ls command to list group items"
```

---

### Task 8: Create down command

**Files:**
- Create: `src/commands/down.ts`

**Step 1: Write down command**

```typescript
export async function downCommand(groupName: string): Promise<number> {
  // Note: In single-process approach, down is only useful
  // if we add persistent state later
  console.log(`Command 'down ${groupName}' - group will stop when easycli exits`);
  return 0;
}
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/down.ts
git commit -m "feat: add down command (placeholder for future state persistence)"
```

---

### Task 9: Create CLI entry point

**Files:**
- Create: `src/index.ts`

**Step 1: Write CLI entry point**

```typescript
#!/usr/bin/env node

import { upCommand } from './commands/up.js';
import { lsCommand } from './commands/ls.js';
import { downCommand } from './commands/down.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
    return;
  }

  const [command, ...rest] = args;
  const groupName = rest[0];

  if (!groupName) {
    console.error('Error: group name required');
    printUsage();
    process.exit(1);
    return;
  }

  let exitCode = 0;

  switch (command) {
    case 'up':
      exitCode = await upCommand(groupName);
      break;
    case 'ls':
      exitCode = await lsCommand(groupName);
      break;
    case 'down':
      exitCode = await downCommand(groupName);
      break;
    default:
      console.error(`Error: unknown command '${command}'`);
      printUsage();
      exitCode = 1;
  }

  process.exit(exitCode);
}

function printUsage(): void {
  console.log(`
Usage: easycli <command> <group>

Commands:
  up <group>     Start all processes in the group
  ls <group>     List all items in the group
  down <group>   Stop the group (Ctrl+C also works)

Examples:
  easycli up test1
  easycli ls test1
  easycli down test1
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

**Step 2: Run type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Build**

Run: `npm run build`
Expected: `dist/index.js` created

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with command routing"
```

---

### Task 10: Add bin field to package.json

**Files:**
- Modify: `package.json`

**Step 1: Add bin field**

```json
{
  "name": "easycli",
  "version": "1.0.0",
  "main": "dist/index.js",
  "bin": {
    "easycli": "./dist/index.js"
  },
  "type": "module",
  ...
}
```

**Step 2: Build and link**

```bash
npm run build
npm link
```

**Step 3: Test CLI**

Run: `easycli`
Expected: Usage message printed

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add bin field for CLI installation"
```

---

### Task 11: Manual testing

**Files:**
- No files changed

**Step 1: Test ls command**

Run: `easycli ls test1`
Expected: Lists test1 group items

**Step 2: Test unknown group**

Run: `easycli ls nonexistent`
Expected: Error with available groups

**Step 3: Test unknown command**

Run: `easycli invalid test1`
Expected: Error with usage

**Step 4: Test up command (background)**

Run: `easycli up test1 &` then `easycli ls test1`
Expected: Processes start, Ctrl+C stops them

**Step 5: Create test summary**

No commit needed for testing

---

### Task 12: Add README

**Files:**
- Create: `README.md`

**Step 1: Write README**

```markdown
# EasyCLI

A simple CLI tool for managing groups of concurrent processes.

## Installation

```bash
npm install -g easycli
```

## Configuration

Create an `easycli.yml` in your project root:

```yaml
tools:
  kubefwd:
    cmd: kubectl port-forward $1 $2:$3

groups:
  myapp:
    tool: kubefwd
    restart: yes
    items:
      - service1,8080,80
      - service2,8081,80
```

## Usage

```bash
easycli up <group>    # Start all processes in group
easycli ls <group>    # List group items
easycli down <group>  # Stop group (Ctrl+C also works)
```

## Restart Policies

- `yes` - Always restart on exit
- `no` - Never restart
- `unless-stopped` - Restart unless killed by easycli
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with installation and usage"
```

---

## Final Checklist

- [ ] All tasks completed
- [ ] Build passes (`npm run build`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] Manual testing successful
- [ ] README documented
