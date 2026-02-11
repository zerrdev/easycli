#!/usr/bin/env node

import { upCommand } from './commands/up.js';
import { lsCommand } from './commands/ls.js';
import { configCommand } from './commands/config.js';
import { groupsCommand } from './commands/groups.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
    return;
  }

  const [command, ...rest] = args;
  let groupName: string | undefined;
  let verbose = false;

  // Parse flags for commands that support them
  if (command === 'groups') {
    // groups command supports -v/--verbose flags
    const flagIndex = rest.findIndex(arg => arg === '-v' || arg === '--verbose');
    if (flagIndex !== -1) {
      verbose = true;
      // Remove the flag from rest so it's not treated as a group name
      rest.splice(flagIndex, 1);
    }
  }
  groupName = rest[0];

  // config and groups commands don't require group name
  if (command !== 'config' && command !== 'groups' && !groupName) {
    console.error('Error: group name required');
    printUsage();
    process.exit(1);
    return;
  }

  let exitCode = 0;

  switch (command) {
    case 'config':
      exitCode = await configCommand();
      break;
    case 'up':
      exitCode = await upCommand(groupName);
      break;
    case 'ls':
      exitCode = await lsCommand(groupName);
      break;
    case 'groups':
      exitCode = await groupsCommand(verbose);
      break;
    default:
      console.error(`Error: unknown command '${command}'`);
      printUsage();
      exitCode = 1;
  }

  process.exit(exitCode);
}

function printUsage(): void {
  console.log(`
Usage: cligr <command> [options] [group]

Commands:
  config              Open config file in editor
  up <group>          Start all processes in the group
  ls <group>          List all items in the group
  groups [-v|--verbose]  List all groups

Options:
  -v, --verbose       Show detailed group information

Examples:
  cligr config
  cligr up test1
  cligr ls test1
  cligr groups
  cligr groups -v
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
