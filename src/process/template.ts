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
    // Must replace in reverse order to avoid replacing $1 in $10, $11, etc.
    let fullCmd = template;
    for (let i = args.length - 1; i >= 0; i--) {
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
      const result = this.expand(toolTemplate, itemStr, index);

      // If there are more args than placeholders in the template, append them
      // Count unique placeholders in the ORIGINAL template (before replacement)
      const placeholdersInTemplate = (toolTemplate.match(/\$\d+/g) || []);
      // Find the highest placeholder number (e.g., $1, $2 -> highest is 2)
      let maxPlaceholder = 0;
      for (const p of placeholdersInTemplate) {
        const num = parseInt(p.substring(1), 10);
        if (num > maxPlaceholder) maxPlaceholder = num;
      }

      // Only append remaining args if there were placeholders in the template
      // If there are no placeholders, the template is a complete command
      if (maxPlaceholder > 0 && result.args.length > maxPlaceholder) {
        const remainingArgs = result.args.slice(maxPlaceholder);
        result.fullCmd = `${result.fullCmd} ${remainingArgs.join(' ')}`;
      }

      return result;
    } else {
      // Direct executable - use tool as command prefix
      const args = itemStr.split(',').map(s => s.trim());
      let name = args[0] || `item-${index}`;

      // If no commas in itemStr, name should be first word only
      if (!itemStr.includes(',') && args.length === 1) {
        const words = args[0].split(/\s+/);
        name = words[0] || `item-${index}`;
      }

      const fullCmd = tool ? `${tool} ${itemStr}` : itemStr;
      return { name, args, fullCmd };
    }
  }
}
