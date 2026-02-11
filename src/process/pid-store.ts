import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface PidEntry {
  pid: number;
  groupName: string;
  itemName: string;
  startTime: number;
  restartPolicy: 'yes' | 'no' | 'unless-stopped';
  fullCmd: string;
}

export class PidStore {
  private readonly pidsDir: string;

  constructor() {
    this.pidsDir = path.join(os.homedir(), '.cligr', 'pids');
  }

  /**
   * Initialize the PID directory
   */
  async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.pidsDir, { recursive: true });
    } catch (err) {
      // Ignore if already exists
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
    }
  }

  /**
   * Get the PID file path for a specific group and item
   */
  private getPidFilePath(groupName: string, itemName: string): string {
    return path.join(this.pidsDir, `${groupName}_${itemName}.pid`);
  }

  /**
   * Write a PID file with metadata
   */
  async writePid(entry: PidEntry): Promise<void> {
    await this.ensureDir();
    const filePath = this.getPidFilePath(entry.groupName, entry.itemName);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  /**
   * Read all PID entries for a specific group
   */
  async readPidsByGroup(groupName: string): Promise<PidEntry[]> {
    await this.ensureDir();
    const entries: PidEntry[] = [];

    try {
      const files = await fs.readdir(this.pidsDir);
      const prefix = `${groupName}_`;

      for (const file of files) {
        if (file.startsWith(prefix) && file.endsWith('.pid')) {
          try {
            const content = await fs.readFile(path.join(this.pidsDir, file), 'utf-8');
            entries.push(JSON.parse(content) as PidEntry);
          } catch {
            // Skip invalid files
            continue;
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }

    return entries;
  }

  /**
   * Read all PID entries
   */
  async readAllPids(): Promise<PidEntry[]> {
    await this.ensureDir();
    const entries: PidEntry[] = [];

    try {
      const files = await fs.readdir(this.pidsDir);

      for (const file of files) {
        if (file.endsWith('.pid')) {
          try {
            const content = await fs.readFile(path.join(this.pidsDir, file), 'utf-8');
            entries.push(JSON.parse(content) as PidEntry);
          } catch {
            // Skip invalid files
            continue;
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
      return [];
    }

    return entries;
  }

  /**
   * Delete a specific PID file
   */
  async deletePid(groupName: string, itemName: string): Promise<void> {
    const filePath = this.getPidFilePath(groupName, itemName);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // Ignore if file doesn't exist
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  /**
   * Delete all PID files for a group
   */
  async deleteGroupPids(groupName: string): Promise<void> {
    const entries = await this.readPidsByGroup(groupName);
    for (const entry of entries) {
      await this.deletePid(entry.groupName, entry.itemName);
    }
  }

  /**
   * Check if a PID is currently running (cross-platform)
   */
  isPidRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a PID entry is still valid and running.
   * This helps prevent killing wrong processes if PID is reused by the OS.
   * A PID is considered valid if it's running AND started recently (within last 5 minutes).
   */
  isPidEntryValid(entry: PidEntry): boolean {
    if (!this.isPidRunning(entry.pid)) {
      return false;
    }

    // Check if the process start time is recent (within 5 minutes)
    // This prevents killing a wrong process if PID was reused
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return entry.startTime > fiveMinutesAgo;
  }

  /**
   * Remove PID files for processes that are no longer running
   * Returns the list of stale entries that were removed
   */
  async cleanupStalePids(): Promise<PidEntry[]> {
    const allEntries = await this.readAllPids();
    const staleEntries: PidEntry[] = [];

    for (const entry of allEntries) {
      // Check if PID is no longer running OR if entry is too old (> 5 minutes)
      // This helps prevent PID reuse issues
      if (!this.isPidEntryValid(entry)) {
        staleEntries.push(entry);
        await this.deletePid(entry.groupName, entry.itemName);
      }
    }

    return staleEntries;
  }

  /**
   * Get all unique group names that have PID files
   */
  async getRunningGroups(): Promise<string[]> {
    const allEntries = await this.readAllPids();
    const groups = new Set(allEntries.map(e => e.groupName));
    return Array.from(groups);
  }
}
