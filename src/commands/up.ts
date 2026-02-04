import { ConfigLoader } from '../config/loader.js';
import { TemplateExpander } from '../process/template.js';
import { ProcessManager } from '../process/manager.js';

export async function upCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();
  const manager = new ProcessManager();

  // Load group config
  const { config, tool, toolTemplate } = loader.getGroup(groupName);

  // Build process items
  const items = config.items.map((itemStr, index) =>
    TemplateExpander.parseItem(tool, toolTemplate, itemStr, index)
  );

  // Spawn all processes
  manager.spawnGroup(groupName, items, config.restart);

  console.log(`Started group ${groupName} with ${items.length} process(es)`);
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
}
