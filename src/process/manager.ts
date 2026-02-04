import { spawn, ChildProcess } from 'child_process';
import type { GroupConfig, ProcessItem } from '../config/types.js';

export type ProcessStatus = 'running' | 'stopped' | 'failed';

export class ManagedProcess {
  constructor(
    public item: ProcessItem,
    public process: ChildProcess,
    public status: ProcessStatus = 'running'
  ) {}
}

export class ProcessManager {
  private groups = new Map<string, ManagedProcess[]>();
  private restartTimestamps = new Map<string, number[]>();
  private readonly maxRestarts = 3;
  private readonly restartWindow = 10000; // 10 seconds

  spawnGroup(groupName: string, items: ProcessItem[], restartPolicy: GroupConfig['restart']): void {
    if (this.groups.has(groupName)) {
      throw new Error(`Group ${groupName} is already running`);
    }

    const processes: ManagedProcess[] = [];

    for (const item of items) {
      const proc = this.spawnProcess(item, groupName, restartPolicy);
      processes.push(new ManagedProcess(item, proc));
    }

    this.groups.set(groupName, processes);
  }

  private spawnProcess(item: ProcessItem, groupName: string, restartPolicy: GroupConfig['restart']): ChildProcess {
    // Parse command into executable and args, handling quoted strings
    const { cmd, args } = this.parseCommand(item.fullCmd);

    const proc = spawn(cmd, args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32' // Use shell on Windows for better path handling
    });

    // Prefix output with item name
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        process.stdout.write(`[${item.name}] ${data}`);
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        process.stderr.write(`[${item.name}] ${data}`);
      });
    }

    // Handle exit and restart
    proc.on('exit', (code, signal) => {
      this.handleExit(groupName, item, restartPolicy, code, signal);
    });

    return proc;
  }

  private parseCommand(fullCmd: string): { cmd: string; args: string[] } {
    // Handle quoted strings for Windows paths with spaces
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < fullCmd.length; i++) {
      const char = fullCmd[i];
      const nextChar = fullCmd[i + 1];

      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        quoteChar = '';
      } else if (char === ' ' && !inQuote) {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      args.push(current);
    }

    return { cmd: args[0] || '', args: args.slice(1) };
  }

  private handleExit(groupName: string, item: ProcessItem, restartPolicy: GroupConfig['restart'], code: number | null, signal: NodeJS.Signals | null): void {
    // Check if killed by easycli (don't restart if unless-stopped)
    // SIGTERM works on both Unix and Windows in Node.js
    if (restartPolicy === 'unless-stopped' && signal === 'SIGTERM') {
      return;
    }

    // Check restart policy
    if (restartPolicy === 'no') {
      return;
    }

    // Check for crash loop (within the restart window)
    const key = `${groupName}-${item.name}`;
    const now = Date.now();
    const timestamps = this.restartTimestamps.get(key) || [];

    // Filter out timestamps outside the restart window
    const recentTimestamps = timestamps.filter(ts => now - ts < this.restartWindow);
    recentTimestamps.push(now);
    this.restartTimestamps.set(key, recentTimestamps);

    if (recentTimestamps.length > this.maxRestarts) {
      console.error(`[${item.name}] Crash loop detected. Stopping restarts.`);
      return;
    }

    // Restart after delay
    setTimeout(() => {
      console.log(`[${item.name}] Restarting... (exit code: ${code})`);
      const newProc = this.spawnProcess(item, groupName, restartPolicy);

      // Update the ManagedProcess in the groups Map with the new process handle
      const processes = this.groups.get(groupName);
      if (processes) {
        const managedProc = processes.find(mp => mp.item.name === item.name);
        if (managedProc) {
          managedProc.process = newProc;
        }
      }
    }, 1000);
  }

  killGroup(groupName: string): Promise<void> {
    const processes = this.groups.get(groupName);
    if (!processes) return Promise.resolve();

    const killPromises = processes.map(mp => this.killProcess(mp.process));

    this.groups.delete(groupName);
    return Promise.all(killPromises).then(() => {});
  }

  private killProcess(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      // First try SIGTERM for graceful shutdown
      proc.kill('SIGTERM');

      // Force kill with SIGKILL after 5 seconds if still running
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      // If already dead, resolve immediately
      if (proc.killed || proc.exitCode !== null) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  killAll(): Promise<void> {
    const killPromises: Promise<void>[] = [];
    for (const groupName of this.groups.keys()) {
      killPromises.push(this.killGroup(groupName));
    }
    return Promise.all(killPromises).then(() => {});
  }

  getGroupStatus(groupName: string): ProcessStatus[] {
    const processes = this.groups.get(groupName);
    if (!processes) return [];

    return processes.map(mp => mp.status);
  }

  isGroupRunning(groupName: string): boolean {
    return this.groups.has(groupName);
  }

  getRunningGroups(): string[] {
    return Array.from(this.groups.keys());
  }
}
