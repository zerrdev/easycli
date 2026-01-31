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

## Usage

```bash
easycli up <group>    # Start all processes in group
easycli ls <group>    # List group items
easycli down <group>  # Stop group (Ctrl+C also works)
```

## Restart Policies

- `yes` - Always restart on exit
- `no` - Never restart
- `unless-stopped` - Restart unless killed by easycli
