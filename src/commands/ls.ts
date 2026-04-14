import { ConfigLoader } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { config, restart } = loader.getGroup(groupName);

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${restart}`);
    console.log('\nItems:');

    const disabled = new Set(config.disabledItems || []);
    for (const [name, value] of Object.entries(config.items || {})) {
      const marker = disabled.has(name) ? ' [disabled]' : '';
      console.log(`  ${name}: ${value}${marker}`);
    }

    console.log('');

    return 0;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConfigError') {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}
