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

Placeholders in a tool's cmd:
  $1, $2, $3...           The item's comma-separated values
  $name                   A named param from the group's "params"
  $[[ ... ]]              Repeat the fragment once per item, joined by the
                          tool's "separator" (default a space). The group then
                          runs as one process named after the group.

  cmd:   ssh $[[-L $1]] user@jumphost -N
  items: grafana: 13000:10.3.2.10:3000
         nexus:   8081:10.3.2.10:8081
  runs:  ssh -L 13000:10.3.2.10:3000 -L 8081:10.3.2.10:8081 user@jumphost -N

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
