import { ConfigLoader } from '../config/loader.js';

export async function lsCommand(groupName: string): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { config, items } = loader.getGroup(groupName);

    console.log(`\nGroup: ${groupName}`);
    console.log(`Tool: ${config.tool}`);
    console.log(`Restart: ${config.restart}`);
    console.log('\nItems:');

    for (const item of items) {
      console.log(`  ${item.name}: ${item.value}`);
    }

    console.log('');

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
