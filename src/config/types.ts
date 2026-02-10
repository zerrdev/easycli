export interface ToolConfig {
  cmd: string;
}

export interface GroupConfig {
  tool: string;
  restart: 'yes' | 'no' | 'unless-stopped';
  items: string[];
}

export interface CliGrConfig {
  tools?: Record<string, ToolConfig>;
  groups: Record<string, GroupConfig>;
}

export interface ProcessItem {
  name: string;
  args: string[];
  fullCmd: string;
}
