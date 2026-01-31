# EasyCLI

A simple CLI tool for managing groups of concurrent processes.

## Installation

```bash
npm install -g easycli
```

## Configuration

Create a `.easycli.yml` configuration file. EasyCLI looks for the config in:

1. **User home directory** (`~/.easycli.yml`) - checked first
2. **Current directory** (`./.easycli.yml`) - fallback

You can keep a global config in your home directory and override it per project.

Quick start:

```bash
easycli config  # Opens ~/.easycli.yml in your editor
```

This creates a config file with examples if it doesn't exist.

Example config:

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

**Syntax:**
- Items are comma-separated: `"name,arg2,arg3"`
- `$1` = name (first value)
- `$2`, `$3`... = additional arguments
- If no `tool` specified, executes directly

## Usage

```bash
easycli config        # Open config file in editor
easycli up <group>    # Start all processes in group
easycli ls <group>    # List group items
easycli down <group>  # Stop group (Ctrl+C also works)
```

## Restart Policies

- `yes` - Always restart on exit
- `no` - Never restart
- `unless-stopped` - Restart unless killed by easycli
