#!/usr/bin/env node

import { upCommand } from './commands/up.js';
import { lsCommand } from './commands/ls.js';
import { configCommand } from './commands/config.js';
import { groupsCommand } from './commands/groups.js';
import { serveCommand } from './commands/serve.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(1);
    return;
  }

  const [firstArg, ...rest] = args;
  let verbose = false;

  // Check if this is a known command
  const knownCommands = ['config', 'up', 'ls', 'groups', 'serve'];

  if (knownCommands.includes(firstArg)) {
    // It's a command
    const command = firstArg;
    let groupName: string | undefined;

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
    if (command !== 'config' && command !== 'groups' && command !== 'serve' && !groupName) {
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
        exitCode = await upCommand(groupName!);
        break;
      case 'ls':
        exitCode = await lsCommand(groupName!);
        break;
      case 'groups':
        exitCode = await groupsCommand(verbose);
        break;
      case 'serve':
        exitCode = await serveCommand(rest[0]);
        break;
    }

    process.exit(exitCode);
  } else {
    // Treat as a group name - run up command
    const exitCode = await upCommand(firstArg);
    process.exit(exitCode);
  }
}

function printUsage(): void {
  console.log(`
Usage: cligr <group> | <command> [options]

Commands:
  config              Open config file in editor
  ls <group>          List all items in the group
  groups [-v|--verbose]   List all groups
  serve [port]        Start web UI server (default port 7373)

Options:
  -v, --verbose       Show detailed group information

Examples:
  cligr test1         Start all processes in test1 group
  cligr config
  cligr ls test1
  cligr groups
  cligr groups -v
  cligr serve
  cligr serve 8080
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
