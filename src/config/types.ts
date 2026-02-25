export interface ToolConfig {
  cmd: string;
}

export interface ItemEntry {
  name: string;   // the key from config (e.g., "nginxService1")
  value: string;  // the value string (e.g., "nginx,8080")
}

export interface GroupConfig {
  tool: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  params?: Record<string, string>;
  items: Record<string, string>;
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
