import fs from 'fs';
import { ConfigLoader, ConfigError } from '../config/loader.js';
import { TemplateExpander } from './template.js';
import { ProcessManager } from './manager.js';
import type { GroupConfig } from '../config/types.js';

export class Supervisor {
  private processManager: ProcessManager;
  private configLoader: ConfigLoader;
  private groupName: string;
  private configPath: string;
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private restarting = false;
  private readonly debounceMs = 1000;

  constructor(
    processManager: ProcessManager,
    configLoader: ConfigLoader,
    groupName: string
  ) {
    this.processManager = processManager;
    this.configLoader = configLoader;
    this.groupName = groupName;
    this.configPath = configLoader.getConfigPath();
  }

  start(): void {
    const { config, items, tool, toolTemplate, params, restart } =
      this.configLoader.getGroup(this.groupName);

    const processItems = items.map((item, index) =>
      TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
    );

    this.processManager.spawnGroup(this.groupName, processItems, restart);
    console.log(`[watch] Watching ${this.configPath} for changes...`);

    this.watcher = fs.watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        this.handleFileChange();
      }
    });
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    await this.processManager.killAll();
  }

  private handleFileChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.reload();
    }, this.debounceMs);
  }

  private async reload(): Promise<void> {
    if (this.restarting) {
      return;
    }
    this.restarting = true;

    try {
      console.log('[watch] Config changed, restarting group...');

      await this.processManager.killGroup(this.groupName);
      console.log('[watch] Old processes stopped');

      let retryCount = 0;
      const maxRetries = 1;

      while (retryCount <= maxRetries) {
        try {
          const { items, tool, toolTemplate, params, restart } =
            this.configLoader.getGroup(this.groupName);

          const processItems = items.map((item, index) =>
            TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
          );

          this.processManager.spawnGroup(this.groupName, processItems, restart);
          console.log('[watch] Group restarted');
          return;
        } catch (err) {
          if (err instanceof ConfigError) {
            console.error(`[watch] Config error: ${err.message}. Keeping current processes running.`);
            return;
          }

          retryCount++;
          if (retryCount <= maxRetries) {
            console.error(`[watch] Restart failed: ${(err as Error).message}. Retrying in 3s...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          } else {
            console.error(`[watch] Restart failed: ${(err as Error).message}. Keeping watching.`);
          }
        }
      }
    } finally {
      this.restarting = false;
    }
  }
}
