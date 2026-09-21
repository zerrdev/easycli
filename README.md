# Cligr

Run a group of related processes from one config file. Define your port-forwards,
tunnels, dev servers or one-shot tasks once in YAML, start them all with a single
command, and watch them in an interactive terminal dashboard.

## Installation

```bash
npm i -g cligr
```

Requires Node 22 or newer.

## Quick start

```bash
cligr config    # creates ~/.cligr.yml with examples and opens it
cligr groups    # list the groups you just defined
cligr myapp     # start one
```

## How it works

A **tool** is a command template. A **group** is a list of **items** the tool is applied
to. Running a group spawns one process per item and supervises them all until you press
Ctrl+C.

```yaml
tools:
  kubefwd:
    cmd: kubectl port-forward $1 $2:$3
    restart: yes

groups:
  myapp:
    tool: kubefwd
    items:
      api: "service/api,8080,80"
      worker: "service/worker,8081,80"
```

`cligr myapp` runs both port-forwards, restarts them when they drop, and shows their
state in the dashboard.

## Configuration

### Where the config lives

Cligr reads `.cligr.yml` from the first location that exists:

1. **Home directory** (`~/.cligr.yml`)
2. **Current directory** (`./.cligr.yml`)

The home config wins when both exist — a project-local `.cligr.yml` is only read when
there is no config in your home directory. `cligr config-path` prints which file is in
effect.

### Items

Each item is a name and a comma-separated value:

```yaml
items:
  api: "service/api,8080,80"
```

- Item names must be unique within a group, and are what `ls`, the dashboard and log
  prefixes show
- Values are split on commas and trimmed, then substituted into the tool's `cmd`
- If the group's `tool` has no matching entry under `tools:`, the item's value is run as
  the command verbatim

### Placeholders

Placeholders are expanded in a tool's `cmd` before the process is spawned.

| Placeholder | Expands to |
| --- | --- |
| `$1`, `$2`, `$3`... | The item's comma-separated values, in order |
| `$name` | The matching entry in the group's `params` |
| `$[[ ... ]]` | The fragment repeated once per enabled item (see [Repeating params](#repeating-params)) |

Values beyond the highest placeholder in the template are appended to the end of the
command, so `cmd: node $1.js` with an item value of `server,--port,3000` runs
`node server.js --port 3000`.

### Named params

Named params apply to every item in the group:

```yaml
groups:
  myapp:
    tool: kubefwd
    params:
      namespace: staging
    items:
      api: "service/api,8080,80"
```

`$namespace` in the tool's `cmd` becomes `staging`. Named params are substituted after
positional ones, and only apply when the group uses a registered tool.

### Disabling items

Items can be kept in the config but left out of a run:

```yaml
groups:
  myapp:
    tool: kubefwd
    disabledItems:
      - worker
    items:
      api: "service/api,8080,80"
      worker: "service/worker,8081,80"
```

Disabled items are not started, but they still appear in `ls` and in the dashboard as
`stopped`, so you can start one with the `s` key without editing the config. Every name
listed must match an item in the group.

## Repeating params

Some tools take one fragment per item on a single command rather than one process per
item — an SSH tunnel carrying every forward, for example. Wrap the repeating part of the
tool's `cmd` in `$[[ ... ]]`:

```yaml
tools:
  ssh-multi-fwd:
    cmd: ssh $[[-L $1]] user@jumphost -N
    separator: ' '

groups:
  tunnels:
    tool: ssh-multi-fwd
    items:
      grafana: 13000:10.3.2.10:3000
      nexus: 8081:10.3.2.10:8081
```

runs as **one** process:

```
ssh -L 13000:10.3.2.10:3000 -L 8081:10.3.2.10:8081 user@jumphost -N
```

- The block body expands once per enabled item; `separator` joins the fragments and
  defaults to a single space
- Inside the block, `$1`, `$2`... are the item's comma-separated values as usual, so
  `$[[-L $1:$2:$3]]` with `13000,10.3.2.10,3000` items works equally well
- Named params apply inside and outside the block
- The group shows as a single process named after the group, so `ls`, the dashboard and
  Ctrl+C act on the whole command
- `disabledItems` are left out of the command; a group with none enabled is an error

## The dashboard

A supervised run paints a live panel at the bottom of the terminal, with log output
scrolling above it:

```
──────────────────────────────────────────────────────────────
 myapp · up 2m14s · ● 2 running  ○ 1 stopped
›● api       running
 ● worker    running    ×2  exit 1
 ○ scheduler stopped
 [↑↓] select  [r] restart  [s] stop  [f] filter  [v] cmd  [R] group  [q] quit
```

Each row is an item: a status glyph, its name, its state, and — once it has restarted or
exited — a restart count (`×2`) and the last exit code. The header summarises the group
and its uptime. When more items exist than fit, the top and bottom rows become
`↑ n more` / `↓ n more` and the list scrolls to keep the selection centred.

### Keys

| Key | Action |
| --- | --- |
| `↑` `↓` or `k` `j` | Move the selection |
| `r` | Restart the selected item |
| `R` (shift+r) | Restart every item in the group |
| `s` | Stop the selected item, or start it if it is stopped |
| `f` | Follow the selected item's logs, or stop following |
| `v` | Show or hide the full command of the selected item |
| `q` or `Ctrl+C` | Stop the group and exit |

Stopping an item with `s` never writes to your config, and a manually stopped item is
not brought back by the restart policy. Under `unless-stopped` the stop also outlives
the run — see [Remembering a manual stop](#remembering-a-manual-stop).

### Logs

Running twenty services produces far more output than a terminal can scroll, so the
dashboard holds log lines back rather than streaming everything:

- Press `f` to follow one item; only that item's lines are printed, prefixed with
  `[item]`, and the header shows `filter: <item>`
- The last 50 lines of every item are kept, so focusing an item replays where it has
  been rather than starting blank
- When an item exits non-zero, its last 20 lines are printed under a labelled rule, even
  if you were not following it. A crash loop reports each attempt's own output instead
  of repeating the first.

### When the dashboard is used

The dashboard is active when stdout is a TTY, `--no-ui` was not passed, and the terminal
is at least 8 rows tall. Otherwise cligr falls back to plain prefixed logging — the same
output, streamed and scrolling, which is what you want when piping to a file or running
in CI. Colour is used on a TTY unless `NO_COLOR` is set.

One trade-off: the dashboard owns the keyboard, so children started under it get no
stdin. Use `--no-ui` for a process that needs to prompt you.

## Run modes

By default cligr **supervises** a group: it keeps the processes alive, applies the
restart policy, and holds the terminal open until you press Ctrl+C.

Set `mode: once` for groups whose items are commands that do a job and exit. Cligr runs
them, shows their output, and returns to the shell with a meaningful exit code.

```yaml
tools:
  kubectx:
    cmd: kubectl config use-context $1
    mode: once

groups:
  nav-stg:
    tool: kubectx
    items:
      ctx: "staging"
```

```bash
$ cligr nav-stg
Switched to context "staging".
$
```

Both keys can be set on a tool as a default and overridden on a group:

- `mode` — `monitor` (default) or `once`
- `sequential` — `false` (default) runs items at once; `true` runs them in config order
  and stops at the first failure. Only meaningful with `mode: once`.

```yaml
groups:
  db-migrate:
    tool: node
    mode: once
    sequential: true
    items:
      schema: migrate.js
      seed: seed.js
```

```bash
$ cligr db-migrate
→ schema
Running migration 001... done
→ seed
Inserted 42 rows.
```

In `once` mode there are no restarts, no PID files, and no dashboard — `--no-ui` and
`--ascii` are ignored. Output passes through untouched (colours and interactive prompts
work) whenever only one process runs at a time, which covers single-item groups and
every step of a sequential run. Items running in parallel are prefixed with `[item]`
instead, so their output stays tellable apart.

## Restart policies

`restart` can be set on a **tool** (as a default) or on a **group** (to override the
tool default). It applies to supervised runs only.

| Value | Effect |
| --- | --- |
| `yes` | Restart when the process exits, whatever the exit code |
| `unless-stopped` | The same, except an item you stop by hand stays stopped on the next run |
| `no` | Never restart |

**Omitting `restart` entirely behaves like `yes`** — only an explicit `no` disables
restarting.

Two things stop a restart regardless of policy:

- **Manual stops.** An item you stopped with `s`, and every item in a group you ended
  with Ctrl+C, stays down.
- **Crash loops.** More than 3 restarts within 10 seconds marks the item `crashed` and
  gives up on it. The rest of the group keeps running.

Restarts are delayed by one second.

### Remembering a manual stop

`yes` and `unless-stopped` behave identically while a group is running. They differ on
the next run: under `unless-stopped`, an item you stopped with `s` is remembered and
left stopped when you start the group again.

```
$ cligr myapp
Started group myapp with 2 process(es), 1 stopped earlier
```

The remembered item still shows in the dashboard as `stopped`, so `s` starts it again
and clears the memory. Restarting an item with `r` is not a manual stop and is never
remembered.

This state lives in `~/.cligr/state/<group>.json`, not in your config — writing YAML
back would lose the comments a hand-maintained config carries. Deleting that file
forgets every stop for the group. `disabledItems` remains the way to turn an item off
declaratively; the two combine, and the startup line counts them separately.

## Commands

```bash
cligr <group>             # Start the group (shorthand for: cligr up <group>)
cligr up <group>          # Start all processes in the group
cligr ls <group>          # Show a group's settings and items
cligr groups              # List all group names
cligr groups -v           # List groups as a table with tool, restart and item count
cligr config              # Open the config file in your editor
cligr config-path         # Print the path of the config file
cligr --help              # Show usage
```

`cligr config` creates the file from a commented template if it does not exist, then
opens it — with VS Code if `code` is on your PATH, otherwise `$EDITOR`, otherwise
Notepad on Windows and vim elsewhere.

`cligr config-path` prints the path and nothing else, so it composes:
`cat $(cligr config-path)`. It does not create the file; the path printed is where
`cligr config` would create it.

## Options

Flags can go anywhere in the command line.

| Flag | Effect |
| --- | --- |
| `-v`, `--verbose` | Show detailed group information (`groups`) |
| `--no-ui` | Disable the dashboard, stream plain prefixed logs |
| `--ascii` | Use ASCII instead of Unicode in the dashboard |
| `-h`, `--help` | Show help |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, or a supervised group shut down cleanly |
| `1` | Config error, unknown group, or no arguments given |
| `2` | Unexpected internal error |

A `once` group exits with the first non-zero exit code in config order, or 0 when every
item succeeded. An item that fails to spawn reports `127`; one killed by a signal
reports `1`. Interrupting a `once` run reports `130` for Ctrl+C and `143` for SIGTERM.

## Files

| Path | Purpose |
| --- | --- |
| `~/.cligr.yml` or `./.cligr.yml` | Configuration |
| `~/.cligr/pids/` | PID files for supervised processes, swept for stale entries when a group starts |
| `~/.cligr/state/` | Items stopped by hand in an `unless-stopped` group, one JSON file per group |

## License

MIT
