# Design: `cligr serve` Command

## Goal
Add a `serve` command that starts an HTTP server with a web UI for toggling groups and individual items in `.cligr.yml`. Toggling an item changes a `disabledItems` list in config and restarts the running group. The UI receives real-time updates via Server-Sent Events (SSE).

## 1. Architecture Overview

Running `cligr serve` starts an HTTP server on a default port (`7373`, configurable via `--port`). The UI shows all groups from `.cligr.yml`, each with:
- A master checkbox to start/stop the entire group.
- Per-item checkboxes to enable/disable individual items.

### Core Components
- **`ConfigLoader`**: Gains `saveConfig()` and `toggleItem()` to persist `disabledItems` changes back to `.cligr.yml`.
- **`ProcessManager`**: Extends `EventEmitter` to emit events (`group-started`, `group-stopped`, `item-restarted`, `process-log`). Gains `restartGroup()`.
- **`serve.ts` command**: Sets up HTTP + SSE server; wires UI actions to `ConfigLoader` and `ProcessManager`.
- **UI**: Single-page HTML served inline from memory (no extra files needed).

## 2. Config Changes: `disabledItems`

Each `GroupConfig` gains an optional `disabledItems` string array:

```yaml
groups:
  myapp:
    tool: kubefwd
    restart: yes
    disabledItems:
      - service2
    items:
      service1: "8080,80"
      service2: "8081,80"
```

### ConfigLoader API Additions
- `saveConfig(config: CliGrConfig): void` — writes the full config back to the YAML file while preserving structure.
- `toggleItem(groupName: string, itemName: string, enabled: boolean): void` — adds/removes the item from `disabledItems` and calls `saveConfig()`.

### Filtering
When loading a group for execution (`upCommand` or `serve`), items present in `disabledItems` are filtered out before building `ProcessItem`s.

## 3. HTTP API & SSE

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| GET | `/` | — | Serves the HTML UI |
| GET | `/api/groups` | — | Returns all groups, items, running state, and `disabledItems` |
| POST | `/api/groups/:name/toggle` | `{ enabled: boolean }` | Starts or stops a group |
| POST | `/api/groups/:name/items/:item/toggle` | `{ enabled: boolean }` | Enables/disables an item |
| GET | `/api/events` | — | SSE stream for live updates |

### SSE Event Types
- `status` — Sent whenever a group starts/stops or an item is toggled. Payload includes current state of all groups.
- `log` — Sent when a managed process writes to stdout/stderr. Payload: `{ group, item, line, isError }`.

## 4. UI Behavior

- **Group header**: Shows group name, tool, and a checkbox. Checked = running; unchecked = stopped.
- **Item list**: Each item has a checkbox. Checked = enabled; unchecked = disabled.
- **Live log panel**: Scrollable panel showing the last ~500 lines, prefixed `[group/item]`.

### Interaction Rules
- **Group checkbox toggle**: Checking starts the group with currently enabled items. Unchecking stops the whole group via `ProcessManager.killGroup()`.
- **Item checkbox toggle**: If the group is running, persist the `disabledItems` change, then call `ProcessManager.restartGroup()` (kill previous processes, respawn with the new enabled set). If the group is not running, only persist the config change.
- **Log auto-scroll**: New lines scroll to bottom unless the user has manually scrolled up.

## 5. ProcessManager Changes

`ProcessManager` will extend Node.js `EventEmitter`.

### New Methods
- `restartGroup(groupName, items, restartPolicy)` — kills existing processes, removes the group from the map, then re-spawns with the given items.

### Emitted Events
- `group-started` `(groupName)`
- `group-stopped` `(groupName)`
- `item-restarted` `(groupName, itemName)`
- `process-log` `(groupName, itemName, line: string, isError: boolean)` — stdout/stderr data is split on newlines so only complete lines are emitted

The `serve` command subscribes to these events and forwards them over SSE.

## 6. Error Handling

- **Config write failure**: Return HTTP 500. The UI re-fetches status on error and reverts the checkbox.
- **Group spawn failure**: Emit a `status` event with an `error` field; UI shows an error banner.
- **Port in use**: Print `Port 7373 is already in use` and exit with code 1.
- **Process crash loop**: Existing `ProcessManager` behavior (stop restarting after 3 crashes in 10s). Logged to UI via `process-log` events.

## 7. Testing Approach

- `ConfigLoader`: test `saveConfig()` round-trip and `disabledItems` filtering.
- `serve` command: test that the HTTP server starts and `/api/groups` returns the expected JSON.
- SSE endpoint: test that `ProcessManager` events are forwarded as SSE messages.
- No browser-based tests; test HTTP and SSE semantics directly via HTTP clients.
