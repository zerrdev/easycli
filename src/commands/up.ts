import { ConfigLoader } from '../config/loader.js';
import { TemplateExpander } from '../process/template.js';
import { ProcessManager } from '../process/manager.js';
import { PidStore } from '../process/pid-store.js';
import { Supervisor } from '../process/supervisor.js';

export interface UpOptions {
  watch?: boolean;
}

export async function upCommand(groupName: string, options?: UpOptions): Promise<number> {
  const loader = new ConfigLoader();
  const manager = new ProcessManager();
  const pidStore = new PidStore();

  try {
    // Clean up any stale PID files for this group on startup
    await pidStore.cleanupStalePids();

    if (options?.watch) {
      const supervisor = new Supervisor(manager, loader, groupName);

      supervisor.start();
      console.log(`Started group ${groupName} (watch mode)`);
      console.log('Press Ctrl+C to stop...');

      return new Promise((resolve) => {
        const cleanup = async () => {
          console.log('\nShutting down...');
          process.removeListener('SIGINT', cleanup);
          process.removeListener('SIGTERM', cleanup);
          await supervisor.stop();
          resolve(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
      });
    }

    // Default (non-watch) behavior
    const { config, items, tool, toolTemplate, params, restart } = loader.getGroup(groupName);

    // Build process items
    const processItems = items.map((item, index) =>
      TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
    );

    // Spawn all processes
    manager.spawnGroup(groupName, processItems, restart);

    console.log(`Started group ${groupName} with ${processItems.length} process(es)`);
    console.log('Press Ctrl+C to stop...');

    // Wait for signals
    return new Promise((resolve) => {
      const cleanup = async () => {
        console.log('\nShutting down...');
        process.removeListener('SIGINT', cleanup);
        process.removeListener('SIGTERM', cleanup);
        await manager.killAll();
        resolve(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ConfigError') {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}
