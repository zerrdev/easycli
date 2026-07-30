import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import type { CliGrConfig, GroupConfig, ToolConfig, ItemEntry, RunMode } from './types.js';

const CONFIG_FILENAME = '.cligr.yml';
const RUN_MODES: RunMode[] = ['monitor', 'once'];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConfigLoader {
  private configPath: string;

  constructor(configPath?: string) {
    if (configPath) {
      // User provided explicit path
      this.configPath = path.resolve(configPath);
    } else {
      // Auto-detect: home dir first, then current dir
      const homeDirConfig = path.join(os.homedir(), CONFIG_FILENAME);
      const currentDirConfig = path.resolve(CONFIG_FILENAME);

      if (fs.existsSync(homeDirConfig)) {
        this.configPath = homeDirConfig;
      } else if (fs.existsSync(currentDirConfig)) {
        this.configPath = currentDirConfig;
      } else {
        // Store home dir as default, will error in load()
        this.configPath = homeDirConfig;
      }
    }
  }

  getConfigPath(): string {
    return this.configPath;
  }

  load(): CliGrConfig {
    if (!fs.existsSync(this.configPath)) {
      throw new ConfigError(
        `Config file not found. Looking for:\n` +
        `  - ${path.join(os.homedir(), CONFIG_FILENAME)}\n` +
        `  - ${path.resolve(CONFIG_FILENAME)}`
      );
    }

    const content = fs.readFileSync(this.configPath, 'utf-8');
    let config: unknown;

    try {
      config = yaml.load(content);
    } catch (err) {
      throw new ConfigError(`Invalid YAML: ${(err as Error).message}`);
    }

    return this.validate(config);
  }

  private validate(config: unknown): CliGrConfig {
    if (!config || typeof config !== 'object') {
      throw new ConfigError('Config must be an object');
    }

    const cfg = config as Record<string, unknown>;

    if (!cfg.groups || typeof cfg.groups !== 'object') {
      throw new ConfigError('Config must have a "groups" object');
    }

    if (cfg.tools && typeof cfg.tools === 'object') {
      for (const [toolName, tool] of Object.entries(cfg.tools as Record<string, unknown>)) {
        if (tool && typeof tool === 'object') {
          this.validateRunMode(tool as Record<string, unknown>, `Tool "${toolName}"`);
        }
      }
    }

    // Validate each group's items
    for (const [groupName, group] of Object.entries(cfg.groups as Record<string, unknown>)) {
      if (group && typeof group === 'object') {
        const groupObj = group as Record<string, unknown>;
        this.validateItems(groupObj.items, groupName);
        this.validateDisabledItems(groupObj.items, groupObj.disabledItems, groupName);
        this.validateRunMode(groupObj, `Group "${groupName}"`);
      }
    }

    return cfg as unknown as CliGrConfig;
  }

  private validateRunMode(entry: Record<string, unknown>, label: string): void {
    const { mode, sequential } = entry;

    if (mode !== undefined && !RUN_MODES.includes(mode as RunMode)) {
      throw new ConfigError(
        `${label}: mode must be one of ${RUN_MODES.join(', ')} (got "${String(mode)}")`
      );
    }

    if (sequential !== undefined && typeof sequential !== 'boolean') {
      throw new ConfigError(`${label}: sequential must be true or false`);
    }
  }

  private validateItems(items: unknown, groupName: string): void {
    if (items === undefined || items === null) {
      return;
    }

    if (typeof items !== 'object' || Array.isArray(items)) {
      throw new ConfigError(
        `Group "${groupName}": items must be an object with named entries, e.g.:\n` +
        '  items:\n' +
        '    serviceName: "value1,value2"'
      );
    }

    const seenNames = new Set<string>();

    for (const [name, value] of Object.entries(items as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new ConfigError(`Group "${groupName}": item "${name}" must have a string value`);
      }

      if (seenNames.has(name)) {
        throw new ConfigError(
          `Group "${groupName}": duplicate item name "${name}". ` +
          `Item names must be unique within a group.`
        );
      }
      seenNames.add(name);
    }
  }

  private validateDisabledItems(items: unknown, disabledItems: unknown, groupName: string): void {
    if (disabledItems === undefined || disabledItems === null) {
      return;
    }

    if (!Array.isArray(disabledItems)) {
      throw new ConfigError(`Group "${groupName}": disabledItems must be an array of strings`);
    }

    const seen = new Set<string>();
    const itemKeys = items && typeof items === 'object' && !Array.isArray(items)
      ? new Set(Object.keys(items as Record<string, unknown>))
      : new Set<string>();

    for (const entry of disabledItems) {
      if (typeof entry !== 'string') {
        throw new ConfigError(`Group "${groupName}": disabledItems must be an array of strings`);
      }

      if (seen.has(entry)) {
        throw new ConfigError(`Group "${groupName}": disabledItems contains duplicate "${entry}"`);
      }
      seen.add(entry);

      if (!itemKeys.has(entry)) {
        throw new ConfigError(`Group "${groupName}": disabledItems entry "${entry}" does not match any item`);
      }
    }
  }

  private normalizeItems(items: Record<string, string>): ItemEntry[] {
    return Object.entries(items).map(([name, value]) => ({
      name,
      value
    }));
  }

  getGroup(name: string): { config: GroupConfig; items: ItemEntry[]; disabledNames: string[]; tool: string | null; toolTemplate: string | null; params: Record<string, string>; restart: GroupConfig['restart']; mode: RunMode; sequential: boolean } {
    const config = this.load();
    const group = config.groups[name];

    if (!group) {
      const available = Object.keys(config.groups).join(', ');
      throw new ConfigError(`Unknown group: ${name}. Available: ${available}`);
    }

    // Disabled items are returned alongside the rest, in config order, so the
    // caller can list them as stopped and start them without a config edit.
    const items = this.normalizeItems(group.items || {});
    const disabled = new Set(group.disabledItems || []);
    const disabledNames = items.filter(i => disabled.has(i.name)).map(i => i.name);

    // Resolve tool
    let toolTemplate: string | null = null;
    let tool: string | null = null;

    if (config.tools && config.tools[group.tool]) {
      toolTemplate = config.tools[group.tool].cmd;
      tool = group.tool;
    } else {
      tool = null;
      toolTemplate = null;
    }

    const params = group.params || {};
    const toolConfig: ToolConfig | undefined = config.tools?.[group.tool];
    const restart = group.restart ?? toolConfig?.restart;

    // Both settings resolve group-over-tool, the same way restart does.
    const mode = group.mode ?? toolConfig?.mode ?? 'monitor';
    const sequential = group.sequential ?? toolConfig?.sequential ?? false;

    return { config: group, items, disabledNames, tool, toolTemplate, params, restart, mode, sequential };
  }

  getEffectiveRestart(groupName: string): GroupConfig['restart'] {
    const config = this.load();
    const group = config.groups[groupName];

    if (!group) {
      const available = Object.keys(config.groups).join(', ');
      throw new ConfigError(`Unknown group: ${groupName}. Available: ${available}`);
    }

    return group.restart ?? config.tools?.[group.tool]?.restart;
  }

  saveConfig(config: CliGrConfig): void {
    const yamlContent = yaml.dump(config, { indent: 2, lineWidth: -1 });
    fs.writeFileSync(this.configPath, yamlContent, 'utf-8');
  }

  toggleItem(groupName: string, itemName: string, enabled: boolean): void {
    const config = this.load();
    const group = config.groups[groupName];
    if (!group) {
      throw new ConfigError(`Unknown group: ${groupName}`);
    }

    if (!Object.hasOwn(group.items || {}, itemName)) {
      throw new ConfigError(`Item "${itemName}" not found in group "${groupName}"`);
    }

    const disabled = new Set(group.disabledItems || []);
    if (enabled) {
      disabled.delete(itemName);
    } else {
      disabled.add(itemName);
    }

    if (disabled.size === 0) {
      delete (group as unknown as Record<string, unknown>).disabledItems;
    } else {
      group.disabledItems = Array.from(disabled);
    }

    this.saveConfig(config);
  }

  listGroups(): string[] {
    const config = this.load();
    return Object.keys(config.groups);
  }
}
