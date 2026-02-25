import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import type { CliGrConfig, GroupConfig, ToolConfig, ItemEntry } from './types.js';

const CONFIG_FILENAME = '.cligr.yml';

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

    // Validate each group's items
    for (const [groupName, group] of Object.entries(cfg.groups as Record<string, unknown>)) {
      if (group && typeof group === 'object') {
        const groupObj = group as Record<string, unknown>;
        this.validateItems(groupObj.items, groupName);
      }
    }

    return cfg as unknown as CliGrConfig;
  }

  private validateItems(items: unknown, groupName: string): void {
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
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

  private normalizeItems(items: Record<string, string>): ItemEntry[] {
    return Object.entries(items).map(([name, value]) => ({
      name,
      value
    }));
  }

  getGroup(name: string): { config: GroupConfig; items: ItemEntry[]; tool: string | null; toolTemplate: string | null; params: Record<string, string> } {
    const config = this.load();
    const group = config.groups[name];

    if (!group) {
      const available = Object.keys(config.groups).join(', ');
      throw new ConfigError(`Unknown group: ${name}. Available: ${available}`);
    }

    // Normalize items to ItemEntry[]
    const items = this.normalizeItems(group.items);

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

    return { config: group, items, tool, toolTemplate, params };
  }

  listGroups(): string[] {
    const config = this.load();
    return Object.keys(config.groups);
  }
}
