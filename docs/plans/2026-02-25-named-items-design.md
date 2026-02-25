# Named Items Design

**Date:** 2026-02-25
**Status:** Approved

## Overview

Update the config system to support named items in groups. Instead of an array of item strings, items will be a map where keys are explicit names and values are the item strings.

## Motivation

- **Better identification:** Explicit names make it easier to identify services in logs and `ls` output
- **Consistent naming:** Process names, log prefixes, and PID files all use the explicit name
- **Clearer config:** Named items are more self-documenting than positional arrays

## Changes

### 1. Type Changes (`src/config/types.ts`)

Add new `ItemEntry` type and update `GroupConfig`:

```typescript
export interface ItemEntry {
  name: string;   // the key from config (e.g., "nginxService1")
  value: string;  // the value string (e.g., "nginx,8080")
}

export interface GroupConfig {
  tool: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  params?: Record<string, string>;
  items: Record<string, string>;  // only named format
}
```

### 2. Config Loader Changes (`src/config/loader.ts`)

- Add `normalizeItems()` method to convert object to `ItemEntry[]`
- Update `getGroup()` to return normalized items
- Add validation for items format and unique names

```typescript
private normalizeItems(items: Record<string, string>): ItemEntry[] {
  return Object.entries(items).map(([name, value]) => ({
    name,
    value
  }));
}

private validateItems(items: unknown, groupName: string): void {
  if (!items || typeof items !== 'object' || Array.isArray(items)) {
    throw new ConfigError(
      'items must be an object with named entries, e.g.:\n' +
      '  items:\n' +
      '    serviceName: "value1,value2"'
    );
  }

  const seenNames = new Set<string>();

  for (const [name, value] of Object.entries(items as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new ConfigError(`Item "${name}" must have a string value`);
    }

    if (seenNames.has(name)) {
      throw new ConfigError(
        `Duplicate item name "${name}" in group "${groupName}". ` +
        `Item names must be unique within a group.`
      );
    }
    seenNames.add(name);
  }
}
```

### 3. TemplateExpander Changes (`src/process/template.ts`)

Update `expand()` and `parseItem()` to accept `ItemEntry`:

```typescript
static expand(
  template: string,
  item: ItemEntry,
  index: number,
  params: Record<string, string> = {}
): ProcessItem {
  const args = item.value.split(',').map(s => s.trim());
  const name = item.name;  // Use explicit name
  // ... rest of expansion logic
}
```

### 4. ls Command Changes (`src/commands/ls.ts`)

Display items in `name: value` format:

```typescript
for (const item of items) {
  console.log(`  ${item.name}: ${item.value}`);
}
```

**Example output:**
```
Group: web
Tool: docker
Restart: false

Items:
  nginxService1: nginx,8080
  nginxService2: nginx,3000
```

### 5. up Command Changes (`src/commands/up.ts`)

Pass `ItemEntry` to template expander:

```typescript
const processItems = items.map((item, index) =>
  TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
);
```

### 6. No Changes Required

- `src/process/manager.ts` - Uses `ProcessItem.name` as-is, no changes needed
- `src/process/pid-store.ts` - Uses item name passed from manager, no changes needed

## Config Example

**Before:**
```yaml
groups:
  web:
    tool: docker
    restart: false
    items:
      - "nginx,8080"
      - "nginx,3000"
```

**After:**
```yaml
groups:
  web:
    tool: docker
    restart: false
    items:
      nginxService1: "nginx,8080"
      nginxService2: "nginx,3000"
```

## Files to Modify

1. `src/config/types.ts` - Add `ItemEntry`, update `GroupConfig.items`
2. `src/config/loader.ts` - Add normalization and validation
3. `src/process/template.ts` - Accept `ItemEntry`
4. `src/commands/ls.ts` - Update output format
5. `src/commands/up.ts` - Pass `ItemEntry` to expander

## Breaking Change

This is a **breaking change** for existing configs. Users must update their configs to use the named format.
