# Groups Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `groups` command to list all available groups defined in the easycli config, with simple and verbose output modes.

**Architecture:** Create a new command function that uses the existing `ConfigLoader.listGroups()` method. Add command-line flag parsing in the main switch statement to handle `-v`/`--verbose` options.

**Tech Stack:** TypeScript, Node.js built-in test runner, esbuild for building

---

### Task 1: Create groups command file

**Files:**
- Create: `src/commands/groups.ts`

**Step 1: Write the command implementation**

Create the command file with both simple and verbose modes:

```typescript
import { ConfigLoader } from '../config/loader.js';

interface GroupDetails {
  name: string;
  tool: string;
  restart: string;
  itemCount: number;
}

export async function groupsCommand(verbose: boolean): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const groupNames = loader.listGroups();

    if (groupNames.length === 0) {
      // No groups defined - empty output
      return 0;
    }

    if (verbose) {
      // Verbose mode: gather details and print table
      const details: GroupDetails[] = [];

      for (const name of groupNames) {
        const { config } = loader.getGroup(name);
        details.push({
          name,
          tool: config.tool || '(none)',
          restart: config.restart,
          itemCount: config.items.length,
        });
      }

      // Calculate column widths
      const maxNameLen = Math.max('GROUP'.length, ...details.map(d => d.name.length));
      const maxToolLen = Math.max('TOOL'.length, ...details.map(d => d.tool.length));
      const maxRestartLen = Math.max('RESTART'.length, ...details.map(d => d.restart.length));

      // Print header
      const header = 'GROUP'.padEnd(maxNameLen) + '  ' +
                     'TOOL'.padEnd(maxToolLen) + '  ' +
                     'RESTART'.padEnd(maxRestartLen) + '  ' +
                     'ITEMS';
      console.log(header);

      // Print rows
      for (const d of details) {
        const row = d.name.padEnd(maxNameLen) + '  ' +
                    d.tool.padEnd(maxToolLen) + '  ' +
                    d.restart.padEnd(maxRestartLen) + '  ' +
                    String(d.itemCount);
        console.log(row);
      }
    } else {
      // Simple mode: just list names
      for (const name of groupNames) {
        console.log(name);
      }
    }

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/commands/groups.ts
git commit -m "feat: add groups command implementation"
```

---

### Task 2: Add groups to main CLI switch

**Files:**
- Modify: `src/index.ts:17-47`

**Step 1: Import the groups command**

Add at top with other imports (after line 5):

```typescript
import { groupsCommand } from './commands/groups.js';
```

**Step 2: Update command parsing to handle groups with optional flags**

Replace the command parsing section (lines 17-26) with:

```typescript
  const [command, ...rest] = args;
  let groupName: string | undefined;
  let verbose = false;

  // Parse flags for commands that support them
  if (command === 'groups') {
    // groups command supports -v/--verbose flags
    const flagIndex = rest.findIndex(arg => arg === '-v' || arg === '--verbose');
    if (flagIndex !== -1) {
      verbose = true;
      // Remove the flag from rest so it's not treated as a group name
      rest.splice(flagIndex, 1);
    }
    // groups doesn't require a group name
    groupName = rest[0];
  } else {
    // Other commands require group name (except config)
    groupName = rest[0];
  }

  // config and groups commands don't require group name
  if (command !== 'config' && command !== 'groups' && !groupName) {
    console.error('Error: group name required');
    printUsage();
    process.exit(1);
    return;
  }
```

**Step 3: Add groups case to switch**

Add in switch statement (after down case, before default):

```typescript
    case 'groups':
      exitCode = await groupsCommand(verbose);
      break;
```

**Step 4: Update usage text**

Replace `printUsage()` function content with:

```typescript
function printUsage(): void {
  console.log(`
Usage: easycli <command> [options] [group]

Commands:
  config              Open config file in editor
  up <group>          Start all processes in the group
  ls <group>          List all items in the group
  down <group>        Stop the group (Ctrl+C also works)
  groups [-v|--verbose]  List all groups

Options:
  -v, --verbose       Show detailed group information

Examples:
  easycli config
  easycli up test1
  easycli ls test1
  easycli down test1
  easycli groups
  easycli groups -v
`);
}
```

**Step 5: Verify TypeScript compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 6: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: integrate groups command into CLI"
```

---

### Task 3: Write failing tests for groups command (simple mode)

**Files:**
- Modify: `tests/integration/commands.test.ts`

**Step 1: Import the groups command**

Add import at top with other command imports (after line 17):

```typescript
import { groupsCommand } from '../../src/commands/groups.js';
```

**Step 2: Write test for simple list mode**

Add at end of file (before final closing `});`):

```typescript
  describe('groupsCommand', () => {
    it('should list group names in simple mode', async () => {
      const configContent = `
groups:
  web:
    tool: docker
    restart: no
    items:
      - nginx
      - redis

  database:
    tool: docker
    restart: yes
    items:
      - postgres
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await groupsCommand(false);

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('web'));
      assert.ok(output.includes('database'));
    });
  });
```

**Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - groupsCommand is not yet imported in test file

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS - test should pass with our implementation

**Step 5: Commit**

```bash
git add tests/integration/commands.test.ts
git commit -m "test: add groups command simple mode test"
```

---

### Task 4: Write test for verbose mode

**Files:**
- Modify: `tests/integration/commands.test.ts`

**Step 1: Add verbose mode test**

Add to groupsCommand describe block:

```typescript
    it('should show detailed table in verbose mode', async () => {
      const configContent = `
tools:
  docker:
    cmd: docker run

groups:
  web:
    tool: docker
    restart: unless-stopped
    items:
      - nginx
      - redis
      - postgres

  direct:
    tool: node
    restart: no
    items:
      - server.js
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await groupsCommand(true);

      assert.strictEqual(exitCode, 0);
      const output = getLogOutput();
      assert.ok(output.includes('GROUP'));
      assert.ok(output.includes('TOOL'));
      assert.ok(output.includes('RESTART'));
      assert.ok(output.includes('ITEMS'));
      assert.ok(output.includes('web'));
      assert.ok(output.includes('docker'));
      assert.ok(output.includes('unless-stopped'));
      assert.ok(output.includes('3')); // item count for web
      assert.ok(output.includes('direct'));
      assert.ok(output.includes('node'));
      assert.ok(output.includes('1')); // item count for direct
    });
```

**Step 2: Run test**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/integration/commands.test.ts
git commit -m "test: add groups command verbose mode test"
```

---

### Task 5: Write edge case tests

**Files:**
- Modify: `tests/integration/commands.test.ts`

**Step 1: Add empty groups test**

Add to groupsCommand describe block:

```typescript
    it('should handle empty groups list', async () => {
      const configContent = `
groups: {}
`;
      fs.writeFileSync(testConfigPath, configContent);
      resetOutput();

      const exitCode = await groupsCommand(false);

      assert.strictEqual(exitCode, 0);
      assert.strictEqual(getLogOutput(), '');
    });
```

**Step 2: Add config error handling test**

Add to groupsCommand describe block:

```typescript
    it('should handle missing config file', async () => {
      if (fs.existsSync(testConfigPath)) {
        fs.unlinkSync(testConfigPath);
      }
      resetOutput();

      const exitCode = await groupsCommand(false);

      assert.strictEqual(exitCode, 1);
      assert.ok(getErrorOutput().includes('Config file not found'));
    });
```

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add tests/integration/commands.test.ts
git commit -m "test: add groups command edge case tests"
```

---

### Task 6: Update README documentation

**Files:**
- Modify: `README.md:50-57`

**Step 1: Update usage section**

Replace the Usage section with:

```markdown
## Usage

```bash
easycli config              # Open config file in editor
easycli up <group>          # Start all processes in group
easycli ls <group>          # List group items
easycli down <group>        # Stop group (Ctrl+C also works)
easycli groups              # List all groups
easycli groups -v           # List groups with details
```
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add groups command to README"
```

---

### Task 7: Manual verification and final test run

**Step 1: Build and test**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

**Step 2: Manual CLI test (optional)**

Create a test config and run:
```bash
node dist/index.js groups
node dist/index.js groups -v
```

**Step 3: Final commit if any tweaks needed**

---

**Completion Criteria:**
- [x] `groups` command lists group names
- [x] `groups -v` shows detailed table
- [x] All tests pass
- [x] Documentation updated
- [x] TypeScript compiles without errors
