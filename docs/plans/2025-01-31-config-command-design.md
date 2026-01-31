# Config Command Design

**Date:** 2025-01-31
**Author:** Claude
**Status:** Approved

## Overview

Add a `config` command that opens the `.easycli.yml` configuration file in the default editor. If the file doesn't exist, create a template with documentation.

## Architecture

The `config` command differs from other commands - it doesn't take a `group` argument. It simply opens the config file.

**Flow:**
1. Use `ConfigLoader` to discover config path (existing logic: home → current dir → default home)
2. If file doesn't exist, create basic template at `~/.easycli.yml`
3. Open file in editor:
   - Try `code` (VS Code) first
   - If not found, use `EDITOR` environment variable
   - If `EDITOR` not set, use `notepad` (Windows) or `vim` (Unix)

**Files to create/modify:**
- `src/commands/config.ts` - command implementation
- `src/index.ts` - add `config` route

## Template Content

```yaml
groups:
  web:
    tool: docker
    restart: false
    items:
      - "nginx,8080"      # $1=nginx (name), $2=8080 (port)
      - "nginx,3000"

  simple:
    tool: node
    items:
      - "server"          # $1=server (name only)

tools:
  docker:
    cmd: "docker run -p $2:$2 nginx"   # $1=name, $2=port
  node:
    cmd: "node $1.js"                   # $1=file name

# Syntax:
# - Items are comma-separated: "name,arg2,arg3"
# - $1 = name (first value)
# - $2, $3... = additional arguments
# - If no tool specified, executes directly
```

## Editor Detection

**`detectEditor()` function:**
1. Run `where code` (Windows) or `which code` (Unix) - if exit code 0, VS Code installed
2. If not, read `process.env.EDITOR` - if defined, use it
3. If not, use platform default:
   - win32: `'notepad.exe'`
   - else: `'vim'`

**`spawnEditor(filePath, editorCmd)` function:**
- Use `spawn` (not sync) with `detached: true`
- Process runs independently from terminal
- Command returns immediately
- `stdio: 'ignore'` to not connect to parent terminal

**Behavior:**
- `easycli config` → opens file → returns to terminal immediately
- VS Code opens in new window or tab in existing instance
- Terminal free to use

## Error Handling

**Cases to handle:**

1. **File doesn't exist** → Create template, open
2. **File exists** → Just open
3. **Editor not found** → Helpful message:
   ```
   Error: Editor 'code' not found.
   Install VS Code or set EDITOR environment variable.

   Example:
     export EDITOR=vim
     easycli config
   ```
4. **Permission error** → Report and suggest `sudo` or chmod
5. **Home dir not accessible** → Fallback to `./.easycli.yml`

## Testing

**Test scenarios:**

1. Config doesn't exist → Creates template with valid structure
2. Config exists → Doesn't overwrite, just opens
3. Detects VS Code → Returns 'code' if installed
4. Fallback to EDITOR → Uses env var if code doesn't exist
5. Fallback to default → Uses notepad/vim if nothing defined
6. Error: invalid editor → Clear message when EDITOR points to non-existent executable

**Mock approach:**
- Mock `fs.existsSync`, `fs.writeFileSync`
- Mock `spawn` to avoid opening real editor
- Mock `spawnSync` (for code detection)

**Test file:** `tests/commands/config.test.js`
