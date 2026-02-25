# Named Items Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace array-based items with named object format for better service identification in logs, PID files, and ls output.

**Architecture:** Add `ItemEntry` type to normalize named items, update config loader to validate and normalize, pass ItemEntry through template expander to process manager.

**Tech Stack:** TypeScript, js-yaml, Node.js

---

## Task 1: Update Types

**Files:**
- Modify: `src/config/types.ts:5-10`

**Step 1: Add ItemEntry interface**

Add after `ToolConfig` interface (around line 4):

```typescript
export interface ItemEntry {
  name: string;   // the key from config (e.g., "nginxService1")
  value: string;  // the value string (e.g., "nginx,8080")
}
```

**Step 2: Update GroupConfig items type**

Change line 9 from:
```typescript
items: string[];
```

To:
```typescript
items: Record<string, string>;
```

**Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/config/types.ts
git commit -m "feat(types): add ItemEntry and update GroupConfig items to named format"
```

---

## Task 2: Update Config Loader - Validation

**Files:**
- Modify: `src/config/loader.ts:60-72`

**Step 1: Update validate method to validate items**

Replace the `validate` method (lines 60-72) with:

```typescript
private validate(config: unknown): CliGrConfig {
  if (!config || typeof config !== 'object') {
    throw new ConfigError('Config must be an object');
  }

  const cfg = config as Record<string, unknown>;

  if (!cfg.groups || typeof cfg.groups !== 'object') {
    throw new ConfigError('Config must have a "groups" object');
  }

  // Validate each group's items
  for (const [groupName, group] of Object.entries(cfg.groups as Record<string, unknown>)) {
    if (group && typeof group === 'object') {
      const groupObj = group as Record<string, unknown>;
      this.validateItems(groupObj.items, groupName);
    }
  }

  return cfg as unknown as CliGrConfig;
}

private validateItems(items: unknown, groupName: string): void {
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new ConfigError(
      `Group "${groupName}": items must be an object with named entries, e.g.:\n` +
      '  items:\n' +
      '    serviceName: "value1,value2"'
    );
  }

  const seenNames = new Set<string>();

  for (const [name, value] of Object.entries(items as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new ConfigError(`Group "${groupName}": item "${name}" must have a string value`);
    }

    if (seenNames.has(name)) {
      throw new ConfigError(
        `Group "${groupName}": duplicate item name "${name}". ` +
        `Item names must be unique within a group.`
      );
    }
    seenNames.add(name);
  }
}
```

**Step 2: Add ItemEntry import**

Add `ItemEntry` to the import at line 5:
```typescript
import type { CliGrConfig, GroupConfig, ToolConfig, ItemEntry } from './types.js';
```

**Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat(loader): add validation for named items format"
```

---

## Task 3: Update Config Loader - Normalization

**Files:**
- Modify: `src/config/loader.ts:74-100`

**Step 1: Add normalizeItems method**

Add after `validateItems` method:

```typescript
private normalizeItems(items: Record<string, string>): ItemEntry[] {
  return Object.entries(items).map(([name, value]) => ({
    name,
    value
  }));
}
```

**Step 2: Update getGroup return type and implementation**

Replace the `getGroup` method (lines 74-100) with:

```typescript
getGroup(name: string): { config: GroupConfig; items: ItemEntry[]; tool: string | null; toolTemplate: string | null; params: Record<string, string> } {
  const config = this.load();
  const group = config.groups[name];

  if (!group) {
    const available = Object.keys(config.groups).join(', ');
    throw new ConfigError(`Unknown group: ${name}. Available: ${available}`);
  }

  // Normalize items to ItemEntry[]
  const items = this.normalizeItems(group.items);

  // Resolve tool
  let toolTemplate: string | null = null;
  let tool: string | null = null;

  if (config.tools && config.tools[group.tool]) {
    toolTemplate = config.tools[group.tool].cmd;
    tool = group.tool;
  } else {
    tool = null;
    toolTemplate = null;
  }

  const params = group.params || {};

  return { config: group, items, tool, toolTemplate, params };
}
```

**Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: Errors in ls.ts and up.ts (they need updates)

**Step 4: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat(loader): normalize items to ItemEntry[]"
```

---

## Task 4: Update TemplateExpander

**Files:**
- Modify: `src/process/template.ts:26-44`

**Step 1: Add ItemEntry import**

Add at top of file:
```typescript
import type { ProcessItem, ItemEntry } from '../config/types.js';
```

**Step 2: Update expand method signature and implementation**

Replace the `expand` method (lines 26-44) with:

```typescript
static expand(template: string, item: ItemEntry, index: number, params: Record<string, string> = {}): ProcessItem {
  const args = item.value.split(',').map(s => s.trim());

  // Use explicit name from ItemEntry
  const name = item.name;

  // Replace $1, $2, $3 etc. with args (positional params)
  let fullCmd = template;
  for (let i = args.length - 1; i >= 0; i--) {
    const placeholder = `$${i + 1}`;
    fullCmd = fullCmd.replaceAll(placeholder, args[i]);
  }

  // Replace named params ($name, $env, etc.) AFTER positional params
  fullCmd = this.expandNamedParams(fullCmd, params);

  return { name, args, fullCmd };
}
```

**Step 3: Update parseItem method signature and implementation**

Replace the `parseItem` method (lines 54-97) with:

```typescript
static parseItem(
  tool: string | null,
  toolTemplate: string | null,
  item: ItemEntry,
  index: number,
  params: Record<string, string> = {}
): ProcessItem {
  if (toolTemplate) {
    // Use registered tool template
    const result = this.expand(toolTemplate, item, index, params);

    // If there are more args than placeholders in the template, append them
    const placeholdersInTemplate = (toolTemplate.match(/\$\d+/g) || []);
    let maxPlaceholder = 0;
    for (const p of placeholdersInTemplate) {
      const num = parseInt(p.substring(1), 10);
      if (num > maxPlaceholder) maxPlaceholder = num;
    }

    if (maxPlaceholder > 0 && result.args.length > maxPlaceholder) {
      const remainingArgs = result.args.slice(maxPlaceholder);
      result.fullCmd = `${result.fullCmd} ${remainingArgs.join(' ')}`;
    }

    return result;
  } else {
    // Direct executable - use tool as command prefix
    const args = item.value.split(',').map(s => s.trim());
    const name = item.name;
    const fullCmd = tool ? `${tool} ${item.value}` : item.value;
    return { name, args, fullCmd };
  }
}
```

**Step 4: Verify types compile**

Run: `npm run typecheck`
Expected: Errors in up.ts only

**Step 5: Commit**

```bash
git add src/process/template.ts
git commit -m "feat(template): accept ItemEntry instead of raw string"
```

---

## Task 5: Update ls Command

**Files:**
- Modify: `src/commands/ls.ts:14-17`

**Step 1: Update ls to use normalized items**

Replace the `lsCommand` function with:

```typescript
export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { config, items } = loader.getGroup(groupName);

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    for (const item of items) {
      console.log(`  ${item.name}: ${item.value}`);
    }

    console.log('');

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
```

**Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/ls.ts
git commit -m "feat(ls): display named items in name: value format"
```

---

## Task 6: Update up Command

**Files:**
- Modify: `src/commands/up.ts:19-21`

**Step 1: Update up to use normalized items**

Replace line 16 with:
```typescript
const { config, items, tool, toolTemplate, params } = loader.getGroup(groupName);
```

Replace lines 19-21 with:
```typescript
// Build process items
const processItems = items.map((item, index) =>
  TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
);

// Spawn all processes
manager.spawnGroup(groupName, processItems, config.restart);
```

**Step 2: Verify types compile**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/up.ts
git commit -m "feat(up): pass ItemEntry to template expander"
```

---

## Task 7: Update Tests

**Files:**
- Modify: `tests/integration/process-manager.test.ts`

**Step 1: Run existing tests to identify failures**

Run: `npm test`
Expected: Some tests may fail due to config format change

**Step 2: Check test file for config usage**

Read the test file and identify any inline configs that use array format for items.

**Step 3: Update test configs to named format**

Change any test configs from:
```yaml
items:
  - "nginx,8080"
```

To:
```yaml
items:
  nginxService: "nginx,8080"
```

**Step 4: Run tests to verify**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/integration/process-manager.test.ts
git commit -m "test: update tests to use named items format"
```

---

## Task 8: Final Verification

**Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Manual smoke test**

Create a test config file with named items and verify:
- `cligr groups` lists groups
- `cligr ls <group>` shows named items correctly
- `cligr up <group>` starts processes with correct names in logs

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: final cleanup for named items feature"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Update types | `src/config/types.ts` |
| 2 | Add validation | `src/config/loader.ts` |
| 3 | Add normalization | `src/config/loader.ts` |
| 4 | Update template expander | `src/process/template.ts` |
| 5 | Update ls command | `src/commands/ls.ts` |
| 6 | Update up command | `src/commands/up.ts` |
| 7 | Update tests | `tests/integration/process-manager.test.ts` |
| 8 | Final verification | - |
