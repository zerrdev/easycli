# Cligr

A simple CLI tool for managing groups of concurrent processes.

## Installation

```bash
npm i -g cligr
```

## Configuration

Create a `.cligr.yml` configuration file. Cligr looks for the config in:

1. **User home directory** (`~/.cligr.yml`) - checked first
2. **Current directory** (`./.cligr.yml`) - fallback

You can keep a global config in your home directory and override it per project.

Quick start:

```bash
cligr config  # Opens ~/.cligr.yml in your editor
```

This creates a config file with examples if it doesn't exist.

Example config:

```yaml
tools:
  kubefwd:
    cmd: kubectl port-forward $1 $2:$3
    restart: yes

groups:
  myapp:
    tool: kubefwd
    restart: yes
    items:
      service1: "service1,8080,80"
      service2: "service2,8081,80"
```

**Syntax:**
- Each item is a name and a comma-separated value: `itemName: "value1,value2"`
- `$1` = first value, `$2`, `$3`... = the rest
- Item names must be unique within a group, and are what `ls` and the dashboard show
- If no `tool` is specified, the item value runs directly

Named parameters work too, and apply to every item in the group:

```yaml
groups:
  myapp:
    tool: kubefwd
    params:
      namespace: staging
    items:
      service1: "service1,8080,80"
```

Items can be disabled without deleting them:

```yaml
groups:
  myapp:
    tool: kubefwd
    disabledItems:
      - service2
    items:
      service1: "service1,8080,80"
      service2: "service2,8081,80"
```

## Usage

```bash
cligr <group>             # Start the group (shorthand for: cligr up <group>)
cligr up <group>          # Start all processes in group
cligr ls <group>          # List group items
cligr groups              # List all groups
cligr groups -v           # List groups with details
cligr config              # Open config file in editor
cligr --help              # Show help
```

Press Ctrl+C to stop a running group.

**Options:**

| Flag | Effect |
| --- | --- |
| `-v`, `--verbose` | Show detailed group information (`groups`) |
| `--no-ui` | Disable the status dashboard, stream plain prefixed logs |
| `--ascii` | Use ASCII instead of Unicode in the dashboard |
| `-h`, `--help` | Show help |

## Restart Policies

Restart can be set on a **tool** (as a default) or on a **group** (to override the tool default).

- `yes` - Always restart on exit
- `no` - Never restart
- `unless-stopped` - Restart unless killed by cligr

## Run Modes

By default cligr **supervises** a group: it keeps the processes alive, applies the
restart policy, and holds the terminal open until you press Ctrl+C.

Set `mode: once` for groups whose items are commands that do a job and exit. cligr
runs them, shows their output, and returns to the shell with a meaningful exit code.

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

Like `restart`, both keys can be set on a tool as a default and overridden on a group.

- `mode` - `monitor` (default) or `once`
- `sequential` - `false` (default) runs items at once; `true` runs them in config
  order and stops at the first failure. Only meaningful with `mode: once`.

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

In `once` mode there are no restarts, no PID files, and no dashboard — `--no-ui`
and `--ascii` are ignored. Output passes through untouched (colors and
interactive prompts work) whenever only one process runs at a time, which covers
single-item groups and every step of a sequential run. Items running in parallel
are prefixed with `[item]` instead, so their output stays tellable apart.

The exit code is the first non-zero exit in config order, or 0 when everything
succeeded.
