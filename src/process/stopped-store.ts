import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { GroupConfig } from '../config/types.js';

interface GroupState {
  stopped: string[];
}

export interface StartupStopOptions {
  /** Items the config turns off with `disabledItems`. */
  disabledNames: string[];
  /** Items an earlier run remembers being stopped by hand. */
  remembered: string[];
  /** Whether a `$[[ ... ]]` block folds the group into one process. */
  repeating: boolean;
  restart: GroupConfig['restart'];
}

/**
 * Which items a run should leave down. Remembered stops only count under
 * `unless-stopped`; every other policy starts whatever the config enables.
 */
export function stoppedAtStartup(options: StartupStopOptions): string[] {
  // A repeating group is a single process named after the group, so its items
  // are fragments of one command rather than things to stop individually.
  if (options.repeating) return [];

  if (options.restart !== 'unless-stopped') return [...options.disabledNames];

  return [...new Set([...options.disabledNames, ...options.remembered])];
}

/**
 * Remembers items stopped by hand so an `unless-stopped` group leaves them
 * down on the next run. Kept out of the config file on purpose: writing YAML
 * back would lose the comments a hand-maintained config carries.
 */
export class StoppedStore {
  private readonly stateDir: string;

  constructor() {
    this.stateDir = path.join(os.homedir(), '.cligr', 'state');
  }

  private getStateFilePath(groupName: string): string {
    const sanitized = groupName.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(this.stateDir, `${sanitized}.json`);
  }

  private async write(groupName: string, stopped: string[]): Promise<void> {
    await fs.mkdir(this.stateDir, { recursive: true });
    const state: GroupState = { stopped };
    await fs.writeFile(this.getStateFilePath(groupName), JSON.stringify(state, null, 2), 'utf-8');
  }

  async read(groupName: string): Promise<string[]> {
    try {
      const content = await fs.readFile(this.getStateFilePath(groupName), 'utf-8');
      const state = JSON.parse(content) as GroupState;
      return Array.isArray(state.stopped) ? state.stopped : [];
    } catch {
      return [];
    }
  }

  async add(groupName: string, itemName: string): Promise<void> {
    const stopped = await this.read(groupName);
    if (stopped.includes(itemName)) return;

    await this.write(groupName, [...stopped, itemName]);
  }

  async remove(groupName: string, itemName: string): Promise<void> {
    const stopped = await this.read(groupName);
    if (!stopped.includes(itemName)) return;

    await this.write(groupName, stopped.filter(name => name !== itemName));
  }
}
