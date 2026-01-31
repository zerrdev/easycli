# EasyCLI Design Document

**Date:** 2026-01-31
**Author:** Design brainstormed with Claude
**Status:** Approved

## Overview

EasyCLI is a process group manager written in TypeScript/Node.js. It reads a declarative YAML config (`easycli.yml`) and manages groups of concurrent processes spawned from templated commands.

## Architecture

Single-process manager approach: `easycli up` spawns children directly and stays foreground. When easycli exits, it terminates all children.

```
┌─────────────────────────────────────────────────────────────┐
│                     easycli CLI entry                        │
├─────────────────────────────────────────────────────────────┤
│  Command Router    ────►  Config Loader  ────►  Process Manager  │
│  (up/down/ls)           (YAML parser)       (spawn, monitor)   │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── index.ts           # CLI entry point, command routing
├── config/
│   ├── loader.ts      # YAML parser, config validation
│   └── types.ts       # TypeScript interfaces for config
├── process/
│   ├── manager.ts     # ProcessManager class (spawn, kill, monitor)
│   └── template.ts    # Command template expansion ($1, $2, $3)
├── commands/
│   ├── up.ts          # easycli up command
│   ├── down.ts        # easycli down command
│   └── ls.ts          # easycli ls command
└── utils/
    └── logger.ts      # Output formatting
```

## Commands

### `easycli up <group>`

1. Parse `easycli.yml`
2. Find group by name
3. Resolve tool command (from tools map or direct executable)
4. For each item:
   - Parse comma-separated args
   - Expand command template with args
   - Spawn process with stdout/stderr attached (prefixed by item name)
   - Attach auto-restart handler if `restart: yes`
5. Wait for SIGINT/SIGTERM
6. Kill all children and exit

### `easycli ls <group>`

1. Load config
2. Find group
3. Check running status of each item
4. Display table with item names and status (UP/DOWN)

### `easycli down <group>`

1. Terminate all processes in the group

## Key Components

**ConfigLoader** - Reads `easycli.yml`, parses YAML, validates groups, resolves tool commands.

**TemplateExpander** - Replaces `$1`, `$2`, `$3` in command templates with item arguments.

**ProcessManager** - Core orchestrator:
- `spawnGroup(group)` - Spawns all items, stores processes
- `killGroup(group)` - Terminates group processes
- `killAll()` - Terminates everything
- `monitor(process, item, restart)` - Auto-restart on exit

## Process Lifecycle

- Children inherit easycli's stdin/stdout/stderr
- Output prefixed with item name for clarity
- Auto-restart on exit based on `restart` policy
- Tracking: `Map<groupName → Set<ChildProcess>>`

## Restart Policies

| Policy | Behavior |
|--------|----------|
| `yes` | Always restart on exit |
| `no` | Never restart |
| `unless-stopped` | Restart unless killed by easycli (SIGTERM) |

## Error Handling

**Config errors:**
- Missing/invalid YAML → clear error with example
- Unknown group → show available groups
- Unknown tool → fail fast
- Wrong arg count → validation error

**Runtime errors:**
- Spawn failure → kill all, exit
- Repeated crashes (3x/10s) → stop restarting, mark failed
- SIGINT/SIGTERM → graceful shutdown

**Exit codes:**
- `0` = clean shutdown
- `1` = config/validation error
- `2` = runtime error
