# Named Params Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for named parameters in group configs that can be referenced in tool templates using `$paramName` syntax.

**Architecture:** Extend the existing `TemplateExpander` to handle named params alongside positional params ($1, $2). The params are defined at the group level and passed through during template expansion. Named params are replaced AFTER positional params to avoid conflicts.

**Tech Stack:** TypeScript, Node.js, js-yaml

---

## Task 1: Update Types

**Files:**
- Modify: `src/config/types.ts:5-9`

**Step 1: Add params field to GroupConfig type**

Add optional `params` field to `GroupConfig`:

```typescript
export interface GroupConfig {
  tool: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  params?: Record<string, string>;
  items: string[];
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/types.ts
git commit -m "feat(types): add optional params field to GroupConfig"
```

---

## Task 2: Update ConfigLoader

**Files:**
- Modify: `src/config/loader.ts:74-97`

**Step 1: Update getGroup return type to include params**

Modify the `getGroup` method to extract and return params from group config:

```typescript
getGroup(name: string): { config: GroupConfig; tool: string | null; toolTemplate: string | null; params: Record<string, string> } {
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
    tool = null;
    toolTemplate = null;
  }

  // Extract params (default to empty object)
  const params = group.params || {};

  return { config: group, tool, toolTemplate, params };
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat(loader): extract and return params from group config"
```

---

## Task 3: Update TemplateExpander

**Files:**
- Modify: `src/process/template.ts:10-25`

**Step 1: Add expandNamedParams helper method**

Add a new static method to handle named parameter replacement:

```typescript
/**
 * Replaces named params in template ($name, $env, etc.)
 * @param template - Command template with $paramName placeholders
 * @param params - Key-value pairs for substitution
 * @returns Template with named params replaced
 */
private static expandNamedParams(template: string, params: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    const placeholder = `$${key}`;
    result = result.replaceAll(placeholder, value);
  }
  return result;
}
```

**Step 2: Update expand method signature and logic**

Update the `expand` method to accept optional params and apply them after positional replacement:

```typescript
static expand(template: string, itemStr: string, index: number, params: Record<string, string> = {}): ProcessItem {
  const args = itemStr.split(',').map(s => s.trim());

  // Generate name from first arg or use index
  const name = args[0] || `item-${index}`;

  // Replace $1, $2, $3 etc. with args (positional params)
  // Must replace in reverse order to avoid replacing $1 in $10, $11, etc.
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

**Step 3: Update parseItem method signature**

Update `parseItem` to accept optional params:

```typescript
static parseItem(
  tool: string | null,
  toolTemplate: string | null,
  itemStr: string,
  index: number,
  params: Record<string, string> = {}
): ProcessItem {
  if (toolTemplate) {
    // Use registered tool template
    const result = this.expand(toolTemplate, itemStr, index, params);

    // ... rest of the method stays the same
```

**Step 4: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add src/process/template.ts
git commit -m "feat(template): add named params support to TemplateExpander"
```

---

## Task 4: Write Tests for Named Params

**Files:**
- Modify: `tests/integration/template-expander.test.ts`

**Step 1: Add test block for named params**

Add new describe block at the end of the test file (before the closing of the outer describe):

```typescript
  describe('Named params', () => {
    it('should replace named param in template', () => {
      const template = 'node $1.js --name $name';
      const itemStr = 'server';
      const params = { name: 'John doe' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.name, 'server');
      assert.strictEqual(result.fullCmd, 'node server.js --name John doe');
    });

    it('should replace multiple named params', () => {
      const template = 'app --host $host --port $port --env $env';
      const itemStr = 'myapp';
      const params = { host: 'localhost', port: '3000', env: 'production' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'app --host localhost --port 3000 --env production');
    });

    it('should combine positional and named params', () => {
      const template = 'node $1.js --name $name --port $port';
      const itemStr = 'server';
      const params = { name: 'Alice', port: '8080' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'node server.js --name Alice --port 8080');
    });

    it('should handle empty params object', () => {
      const template = 'node $1.js';
      const itemStr = 'server';

      const result = TemplateExpander.expand(template, itemStr, 0, {});

      assert.strictEqual(result.fullCmd, 'node server.js');
    });

    it('should leave unreplaced named params as-is', () => {
      const template = 'node $1.js --name $name --env $env';
      const itemStr = 'server';
      const params = { name: 'Bob' }; // env not provided

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'node server.js --name Bob --env $env');
    });

    it('should replace all occurrences of named param', () => {
      const template = 'echo $name and $name again';
      const itemStr = 'test';
      const params = { name: 'world' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'echo world and world again');
    });

    it('should work with parseItem for registered tools', () => {
      const tool = 'node-param';
      const toolTemplate = 'node $1.js --name $name';
      const itemStr = 'server';
      const params = { name: 'Charlie' };

      const result = TemplateExpander.parseItem(tool, toolTemplate, itemStr, 0, params);

      assert.strictEqual(result.name, 'server');
      assert.strictEqual(result.fullCmd, 'node server.js --name Charlie');
    });

    it('should handle named params with spaces in values', () => {
      const template = 'echo "Hello, $name!"';
      const itemStr = 'test';
      const params = { name: 'John Doe' };

      const result = TemplateExpander.expand(template, itemStr, 0, params);

      assert.strictEqual(result.fullCmd, 'echo "Hello, John Doe!"');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: Named params tests fail (feature not implemented yet)

**Step 3: Commit**

```bash
git add tests/integration/template-expander.test.ts
git commit -m "test: add tests for named params support"
```

---

## Task 5: Update up.ts Command

**Files:**
- Modify: `src/commands/up.ts:16-21`

**Step 1: Pass params to TemplateExpander.parseItem**

Update the `upCommand` to extract and pass params:

```typescript
export async function upCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();
  const manager = new ProcessManager();
  const pidStore = new PidStore();

  try {
    // Clean up any stale PID files for this group on startup
    await pidStore.cleanupStalePids();

    // Load group config
    const { config, tool, toolTemplate, params } = loader.getGroup(groupName);

    // Build process items
    const items = config.items.map((itemStr, index) =>
      TemplateExpander.parseItem(tool, toolTemplate, itemStr, index, params)
    );

    // ... rest stays the same
```

**Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/up.ts
git commit -m "feat(up): pass params to template expander"
```

---

## Task 6: Run All Tests

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass including new named params tests

**Step 2: Run verbose tests for details**

Run: `npm run test:verbose`
Expected: All tests pass with detailed output

---

## Task 7: Integration Test

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Create test config file**

Create a temporary test config at `~/.cligr.yml` (or use existing one) with the named params example:

```yaml
groups:
  test-named-params:
    tool: node-param
    params:
      name: 'John doe'
    items:
      - "server"

tools:
  node-param:
    cmd: "echo $1.js --name $name"
```

**Step 3: Run the command**

Run: `node dist/index.js test-named-params`
Expected: Output shows `echo server.js --name John doe`

---

## Summary

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Update types | `src/config/types.ts` |
| 2 | Update loader | `src/config/loader.ts` |
| 3 | Update template expander | `src/process/template.ts` |
| 4 | Write tests | `tests/integration/template-expander.test.ts` |
| 5 | Update up command | `src/commands/up.ts` |
| 6 | Run all tests | - |
| 7 | Integration test | - |
