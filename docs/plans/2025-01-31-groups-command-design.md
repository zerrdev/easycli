# Groups Command Design

## Overview
Add a `groups` command to list all available groups defined in the easycli config.

## Command Syntax
```bash
easycli groups [-v|--verbose]
```

## Behavior

### Simple Mode (default)
Lists group names, one per line:
```
myapp
staging
production
```

### Verbose Mode (`-v` or `--verbose`)
Shows full details in table format:
```
GROUP     TOOL      RESTART       ITEMS
myapp     kubefwd   yes           3
staging   kubefwd   unless-stop.. 2
```

## Implementation

### Files to Create
- `src/commands/groups.ts` - Command implementation

### Files to Modify
- `src/index.ts` - Add groups case to switch statement, update usage

### Code Structure

**groupsCommand(verbose: boolean)**
1. Load config with `ConfigLoader`
2. Call `listGroups()` to get group names
3. Simple mode: print each name
4. Verbose mode: iterate groups, get details via `getGroup()`, format table

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No config file | Propagate `ConfigError` from loader |
| No groups defined | Empty output (not an error) |
| Invalid flags | Standard command parsing error |

## Testing

- Simple list with multiple groups
- Verbose table shows correct details
- Empty groups returns nothing
- Config errors propagate correctly
