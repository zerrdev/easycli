import type { ProcessItem, ItemEntry } from '../config/types.js';

/** Non-greedy so `$[[$1]] ]]` closes at the first terminator, not the last. */
const REPEATING_BLOCK = '\\$\\[\\[([\\s\\S]*?)\\]\\]';
const DEFAULT_SEPARATOR = ' ';

export class TemplateExpander {
  /**
   * Whether a template folds its group into one process instead of one per item.
   */
  static hasRepeatingBlock(template: string): boolean {
    return new RegExp(REPEATING_BLOCK).test(template);
  }

  /**
   * Replaces $1, $2, $3 etc. with the item's arguments.
   * Highest index first, so $10 is not clipped by the $1 replacement.
   */
  private static expandPositionalParams(template: string, args: string[]): string {
    let result = template;
    for (let i = args.length - 1; i >= 0; i--) {
      result = result.replaceAll(`$${i + 1}`, args[i]);
    }
    return result;
  }

  private static splitArgs(value: string): string[] {
    return value.split(',').map(s => s.trim());
  }

  /**
   * Expands a template whose `$[[ ... ]]` block repeats once per item, producing a
   * single process for the whole group. Used by tools that take one fragment per
   * item on one long-lived command, such as an ssh tunnel carrying every forward.
   * @param template - Command template containing at least one `$[[ ... ]]` block
   * @param name - Process name, which is the group name
   * @param items - Enabled items, in config order
   * @param separator - Joins the fragments the block produces
   * @param params - Optional named params, substituted inside and outside the block
   */
  static expandRepeating(
    template: string,
    name: string,
    items: ItemEntry[],
    separator: string = DEFAULT_SEPARATOR,
    params: Record<string, string> = {}
  ): ProcessItem {
    const argsPerItem = items.map(item => this.splitArgs(item.value));

    const repeated = template.replace(
      new RegExp(REPEATING_BLOCK, 'g'),
      (_match, body: string) =>
        argsPerItem.map(args => this.expandPositionalParams(body, args)).join(separator)
    );

    const fullCmd = this.expandNamedParams(repeated, params);

    return { name, args: argsPerItem.flat(), fullCmd };
  }

  /**
   * Replaces named params in template ($name, $env, etc.)
   * @param template - Command template with $paramName placeholders
   * @param params - Key-value pairs for substitution
   * @returns Template with named params replaced
   */
  private static expandNamedParams(template: string, params: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `$${key}`;
      result = result.replaceAll(placeholder, value);
    }
    return result;
  }

  /**
   * Expands a command template with item arguments
   * @param template - Command template with $1, $2, $3 etc.
   * @param item - ItemEntry with name and value
   * @param index - Item index in group
   * @param params - Optional named params for substitution ($name, $env, etc.)
   * @returns ProcessItem with expanded command
   */
  static expand(template: string, item: ItemEntry, index: number, params: Record<string, string> = {}): ProcessItem {
    const args = this.splitArgs(item.value);

    // Use explicit name from ItemEntry
    const name = item.name;

    // Replace named params ($name, $env, etc.) AFTER positional params
    const fullCmd = this.expandNamedParams(this.expandPositionalParams(template, args), params);

    return { name, args, fullCmd };
  }

  /**
   * Parses item string into command
   * @param tool - Tool name or executable
   * @param toolTemplate - Template from tools config (if registered tool)
   * @param item - ItemEntry with name and value
   * @param index - Item index in group
   * @param params - Optional named params for substitution
   */
  static parseItem(
    tool: string | null,
    toolTemplate: string | null,
    item: ItemEntry,
    index: number,
    params: Record<string, string> = {}
  ): ProcessItem {
    if (toolTemplate) {
      // Use registered tool template
      const result = this.expand(toolTemplate, item, index, params);

      // If there are more args than placeholders in the template, append them
      const placeholdersInTemplate = (toolTemplate.match(/\$\d+/g) || []);
      let maxPlaceholder = 0;
      for (const p of placeholdersInTemplate) {
        const num = parseInt(p.substring(1), 10);
        if (num > maxPlaceholder) maxPlaceholder = num;
      }

      if (maxPlaceholder > 0 && result.args.length > maxPlaceholder) {
        const remainingArgs = result.args.slice(maxPlaceholder);
        result.fullCmd = `${result.fullCmd} ${remainingArgs.join(' ')}`;
      }

      return result;
    } else {
      // Direct executable - use tool as command prefix
      const args = this.splitArgs(item.value);
      const name = item.name;
      const fullCmd = tool ? `${tool} ${item.value}` : item.value;
      return { name, args, fullCmd };
    }
  }
}
