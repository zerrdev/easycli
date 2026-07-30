export interface CliFlags {
  verbose: boolean;
  noUi: boolean;
  ascii: boolean;
}

const FLAG_ALIASES: Record<string, keyof CliFlags> = {
  '-v': 'verbose',
  '--verbose': 'verbose',
  '--no-ui': 'noUi',
  '--ascii': 'ascii'
};

/**
 * Pulls known flags out of the argument list so command dispatch sees only
 * positional arguments, regardless of where the flags were typed.
 */
export function parseFlags(args: string[]): { flags: CliFlags; rest: string[] } {
  const flags: CliFlags = { verbose: false, noUi: false, ascii: false };
  const rest: string[] = [];

  for (const arg of args) {
    const known = FLAG_ALIASES[arg];
    if (known) {
      flags[known] = true;
    } else {
      rest.push(arg);
    }
  }

  return { flags, rest };
}
