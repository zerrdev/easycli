import type { ProcessItem } from '../config/types.js';

export class TemplateExpander {
  /**
   * Expands a command template with item arguments
   * @param template - Command template with $1, $2, $3 etc.
   * @param itemStr - Comma-separated item args (e.g., "service1,8080,80")
   * @returns ProcessItem with expanded command
   */
  static expand(template: string, itemStr: string, index: number): ProcessItem {
    const args = itemStr.split(',').map(s => s.trim());

    // Generate name from first arg or use index
    const name = args[0] || `item-${index}`;

    // Replace $1, $2, $3 etc. with args
    let fullCmd = template;
    for (let i = 0; i < args.length; i++) {
      const placeholder = `$${i + 1}`;
      fullCmd = fullCmd.replaceAll(placeholder, args[i]);
    }

    return { name, args, fullCmd };
  }

  /**
   * Parses item string into command
   * @param tool - Tool name or executable
   * @param toolTemplate - Template from tools config (if registered tool)
   * @param itemStr - Comma-separated args
   * @param index - Item index in group
   */
  static parseItem(tool: string | null, toolTemplate: string | null, itemStr: string, index: number): ProcessItem {
    if (toolTemplate) {
      // Use registered tool template
      return this.expand(toolTemplate, itemStr, index);
    } else {
      // Direct executable - use tool as command prefix
      const args = itemStr.split(',').map(s => s.trim());
      const name = args[0] || `item-${index}`;
      const fullCmd = tool ? `${tool} ${itemStr}` : itemStr;
      return { name, args, fullCmd };
    }
  }
}
