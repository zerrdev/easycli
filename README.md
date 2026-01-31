# EasyCLI

A simple CLI tool for managing groups of concurrent processes.

## Installation

```bash
npm install -g easycli
```

## Configuration

Create an `easycli.yml` in your project root:

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
