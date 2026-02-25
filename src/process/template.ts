import type { ProcessItem, ItemEntry } from '../config/types.js';

export class TemplateExpander {
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
    const args = item.value.split(',').map(s => s.trim());

    // Use explicit name from ItemEntry
    const name = item.name;

    // Replace $1, $2, $3 etc. with args (positional params)
    let fullCmd = template;
    for (let i = args.length - 1; i >= 0; i--) {
      const placeholder = `$${i + 1}`;
      fullCmd = fullCmd.replaceAll(placeholder, args[i]);
    }

    // Replace named params ($name, $env, etc.) AFTER positional params
    fullCmd = this.expandNamedParams(fullCmd, params);

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
      const args = item.value.split(',').map(s => s.trim());
      const name = item.name;
      const fullCmd = tool ? `${tool} ${item.value}` : item.value;
      return { name, args, fullCmd };
    }
  }
}
