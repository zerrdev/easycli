# Improve Web UI Console Logging

## Goal
Enhance the web UI console panel in `cligr serve` with timestamps, system event logging, color-coded output, and a clear button.

## Changes

### 1. Timestamps
- Every log line in the console gets an `[HH:MM:SS]` prefix.
- Generated client-side in the `appendLog` function using `new Date().toLocaleTimeString()`.

### 2. System Events in Console
- When the `status` SSE event fires, log human-readable messages to the console:
  - `group-started` → `[system] Group "<name>" started`
  - `group-stopped` → `[system] Group "<name>" stopped`
  - `item-restarted` → `[system] Item "<group/item>" restarted`

### 3. Color Coding (CSS Classes)
- `.log-time` — muted gray timestamp
- `.log-system` — blue/purple for system events
- `.log-error` — red for stderr lines
- Process stdout stays default green (existing `#0f0` on `#111`)

### 4. Clear Button
- A "Clear" button is added to the console header next to the "Console" title.
- Clicking it empties the `#logs` element.

## Scope
- Only `src/commands/serve.ts` is modified (specifically the `serveHtml()` function).
- No backend or SSE protocol changes.
- No new dependencies.

## Success Criteria
- Console lines show `[HH:MM:SS]` prefix.
- Toggling a group on/off logs a system message in the console.
- Restarting an item logs a system message in the console.
- The Clear button removes all visible log lines.
- Existing process output behavior remains unchanged.
