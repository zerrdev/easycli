# Commands
## cligr <group>
Shorthand for `cligr up <group>`.
## cligr up <group>
Runs each item in a attached thread to the current process using the tool/executable indicated.
Groups configured with `mode: once` instead run their items to completion, print the output, and exit.
Tools whose `cmd` contains a `$[[ ... ]]` block instead run the whole group as one process.
Press Ctrl+C to stop a supervised group.
## cligr ls <group>
Shows all items from this group
## cligr groups
Lists all groups. Add `-v` for a detailed table.
## cligr config
Open config file
## cligr --help
Show usage. Also available as `-h`.

# Placeholders
Placeholders are expanded in a tool's `cmd` before the process is spawned.

| Placeholder | Expands to |
| --- | --- |
| `$1`, `$2`, `$3`... | The item's comma-separated values, trimmed |
| `$name` | The matching entry in the group's `params` |
| `$[[ ... ]]` | The fragment repeated once per enabled item, joined by the tool's `separator` |

`$1` and `$name` are per-item, so the group runs one process per item. A `$[[ ... ]]`
block is per-group: the whole group collapses into a single process named after the
group. See the README for the full description.
