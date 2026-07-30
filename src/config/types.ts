/** `once` runs a group's items to completion and exits instead of supervising them. */
export type RunMode = 'monitor' | 'once';

export interface ToolConfig {
  cmd: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  mode?: RunMode;
  sequential?: boolean;
}

export interface ItemEntry {
  name: string;   // the key from config (e.g., "nginxService1")
  value: string;  // the value string (e.g., "nginx,8080")
}

export interface GroupConfig {
  tool: string;
  restart?: 'yes' | 'no' | 'unless-stopped';
  mode?: RunMode;
  sequential?: boolean;
  params?: Record<string, string>;
  disabledItems?: string[];
  items?: Record<string, string>;
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
