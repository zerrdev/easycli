import { ConfigLoader } from '../config/loader.js';

interface GroupDetails {
  name: string;
  tool: string;
  restart: string;
  itemCount: number;
}

export async function groupsCommand(verbose: boolean): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const groupNames = loader.listGroups();

    if (groupNames.length === 0) {
      // No groups defined - empty output
      return 0;
    }

    if (verbose) {
      // Verbose mode: gather details and print table
      const config = loader.load();
      const details: GroupDetails[] = [];

      for (const name of groupNames) {
        const group = config.groups[name];
        details.push({
          name,
          tool: group.tool || '(none)',
          restart: group.restart,
          itemCount: group.items.length,
        });
      }

      // Calculate column widths
      const maxNameLen = Math.max('GROUP'.length, ...details.map(d => d.name.length));
      const maxToolLen = Math.max('TOOL'.length, ...details.map(d => d.tool.length));
      const maxRestartLen = Math.max('RESTART'.length, ...details.map(d => d.restart.length));

      // Print header
      const header = 'GROUP'.padEnd(maxNameLen) + '  ' +
                     'TOOL'.padEnd(maxToolLen) + '  ' +
                     'RESTART'.padEnd(maxRestartLen) + '  ' +
                     'ITEMS';
      console.log(header);

      // Print rows
      for (const d of details) {
        const row = d.name.padEnd(maxNameLen) + '  ' +
                    d.tool.padEnd(maxToolLen) + '  ' +
                    d.restart.padEnd(maxRestartLen) + '  ' +
                    String(d.itemCount);
        console.log(row);
      }
    } else {
      // Simple mode: just list names
      for (const name of groupNames) {
        console.log(name);
      }
    }

    return 0;
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
}
