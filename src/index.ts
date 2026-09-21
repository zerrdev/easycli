#!/usr/bin/env node

import { upCommand } from './commands/up.js';
import { lsCommand } from './commands/ls.js';
import { configCommand } from './commands/config.js';
import { configPathCommand } from './commands/config-path.js';
import { groupsCommand } from './commands/groups.js';
import { parseFlags } from './cli/flags.js';
import { printUsage } from './cli/usage.js';

const KNOWN_COMMANDS = ['config', 'config-path', 'up', 'ls', 'groups'];
const COMMANDS_WITHOUT_GROUP = ['config', 'config-path', 'groups'];

async function main(): Promise<void> {
  // Flags are stripped up front so every branch below sees only positional
  // arguments, regardless of where the flags were typed.
  const { flags, rest: args } = parseFlags(process.argv.slice(2));

  // Asking for help is never an error, so it exits 0 unlike a bare invocation.
  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const [firstArg, ...rest] = args;
  const upOptions = { noUi: flags.noUi, ascii: flags.ascii };

  if (!KNOWN_COMMANDS.includes(firstArg)) {
    // Treat as a group name - run up command
    process.exit(await upCommand(firstArg, upOptions));
  }

  const command = firstArg;
  const groupName = rest[0];

  if (!COMMANDS_WITHOUT_GROUP.includes(command) && !groupName) {
    console.error('Error: group name required');
    printUsage();
    process.exit(1);
  }

  let exitCode = 0;

  switch (command) {
    case 'config':
      exitCode = await configCommand();
      break;
    case 'config-path':
      exitCode = configPathCommand();
      break;
    case 'up':
      exitCode = await upCommand(groupName, upOptions);
      break;
    case 'ls':
      exitCode = await lsCommand(groupName);
      break;
    case 'groups':
      exitCode = await groupsCommand(flags.verbose);
      break;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
