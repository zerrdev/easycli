import { ConfigLoader, ConfigError } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const config = loader.load().groups[groupName];
    if (!config) {
      throw new ConfigError(`Unknown group: ${groupName}. Available: ${loader.listGroups().join(', ')}`);
    }

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    const disabled = new Set(config.disabledItems || []);
    for (const [name, value] of Object.entries(config.items)) {
      const marker = disabled.has(name) ? ' [disabled]' : '';
      console.log(`  ${name}: ${value}${marker}`);
    }

    console.log('');

    return 0;
  } catch (err) {
    if (err instanceof Error && err.name === 'ConfigError') {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}
