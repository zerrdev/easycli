/**
 * The help text, kept beside the flag parser so the two stay in step: every
 * flag in FLAG_ALIASES and every entry in KNOWN_COMMANDS is listed here.
 */
export function usageText(): string {
  return `
Usage: cligr <group> | <command> [options]

Commands:
  <group>                 Start the group (same as: cligr up <group>)
  up <group>              Start the group
  ls <group>              List all items in the group
  groups [-v]             List all groups
  config                  Open the config file in your editor

Options:
  -v, --verbose           Show detailed group information
  --no-ui                 Disable the status dashboard, stream plain logs
  --ascii                 Use ASCII instead of Unicode in the dashboard
  -h, --help              Show this help

Groups configured with "mode: once" run their items to completion, print the
output, and exit, instead of being supervised.

Examples:
  cligr test1             Start all processes in test1
  cligr test1 --ascii     Start with an ASCII-only dashboard
  cligr nav-stg           Run a one-shot group and exit
  cligr ls test1
  cligr groups -v
  cligr config
`;
}

export function printUsage(): void {
  console.log(usageText());
}
