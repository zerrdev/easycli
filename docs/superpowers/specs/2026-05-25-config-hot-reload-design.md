# Config Hot-Reload via Supervisor

## Summary

Add a `--watch` flag to `cligr <group>` that watches `.cligr.yml` for changes and automatically restarts the group's processes when the config file is saved. Opt-in via flag, full group restart on any change, 1s debounce.

## CLI Interface

```
cligr ticket-dev --watch
```

- `--watch` is parsed from args in `index.ts` in the group shorthand branch (line 70 area)
- The flag is stripped from args before passing the group name
- `upCommand` signature changes to: `upCommand(groupName: string, options?: { watch?: boolean }): Promise<number>`
- Usage help updated to show `--watch` flag

## Architecture: Supervisor Class

New file: `src/process/supervisor.ts`

The `Supervisor` class wraps `ProcessManager` and adds file watching:

```
Supervisor
  - processManager: ProcessManager
  - configLoader: ConfigLoader
  - groupName: string
  - configPath: string
  - watcher: fs.FSWatcher | null
  - debounceTimer: NodeJS.Timeout | null
  - restarting: boolean
```

### Methods

- **start()**: Loads config, spawns group via `ProcessManager.spawnGroup()`, starts `fs.watch` on config path
- **stop()**: Closes watcher, calls `processManager.killAll()`
- **handleFileChange()** (private): Debounces 1s, then performs reload cycle

### Reload cycle

1. Check `restarting` guard (prevents concurrent reloads)
2. Log `[watch] Config changed, restarting group...`
3. `await processManager.killGroup(groupName)`
4. `configLoader.getGroup(groupName)` — catches ConfigError
5. `processManager.spawnGroup(groupName, items, restart)` with fresh config
6. Log `[watch] Group restarted`

## Error Handling

**Invalid config on reload:**
- Catch `ConfigError`, log `[watch] Config error: <message>. Keeping current processes running.`
- Do NOT kill existing processes — they keep running with last known-good config
- Watcher stays active for next save

**Unexpected restart failure:**
- Log `[watch] Restart failed: <message>. Retrying in 3s...`
- Retry once after 3 seconds
- If retry fails, log error and keep watching

## Changes to Existing Files

| File | Change |
|------|--------|
| `src/index.ts` | Parse `--watch` flag, strip from args, pass to upCommand |
| `src/commands/up.ts` | Accept options param, create Supervisor when watch=true |
| `src/process/supervisor.ts` | **New file** |

No changes to `ProcessManager`, `PidStore`, `ConfigLoader`, or `TemplateExpander`.

## Debounce

1 second debounce using `setTimeout` in the `fs.watch` callback. Each new change event resets the timer. Only the last event in a burst triggers the reload.

## Concurrency Guard

A `restarting` boolean prevents overlapping reload cycles. If a file change arrives while a restart is in progress, it's queued and processed after the current restart completes.
