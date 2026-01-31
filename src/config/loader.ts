import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { EasyCliConfig, GroupConfig, ToolConfig } from './types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConfigLoader {
  private configPath: string;

  constructor(configPath: string = 'easycli.yml') {
    this.configPath = path.resolve(configPath);
  }

  load(): EasyCliConfig {
    if (!fs.existsSync(this.configPath)) {
      throw new ConfigError(`Config file not found: ${this.configPath}`);
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

  private validate(config: unknown): EasyCliConfig {
    if (!config || typeof config !== 'object') {
      throw new ConfigError('Config must be an object');
    }

    const cfg = config as Record<string, unknown>;

    if (!cfg.groups || typeof cfg.groups !== 'object') {
      throw new ConfigError('Config must have a "groups" object');
    }

    return cfg as EasyCliConfig;
  }

  getGroup(name: string): { config: GroupConfig; tool: string | null; toolTemplate: string | null } {
    const config = this.load();
    const group = config.groups[name];

    if (!group) {
      const available = Object.keys(config.groups).join(', ');
      throw new ConfigError(`Unknown group: ${name}. Available: ${available}`);
    }

    // Resolve tool
    let toolTemplate: string | null = null;
    let tool: string | null = null;

    if (config.tools && config.tools[group.tool]) {
      toolTemplate = config.tools[group.tool].cmd;
      tool = group.tool;
    } else {
      // Tool might be a direct executable
      tool = null;
      toolTemplate = null;
    }

    return { config: group, tool, toolTemplate };
  }

  listGroups(): string[] {
    const config = this.load();
    return Object.keys(config.groups);
  }
}
