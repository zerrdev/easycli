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
  private restartCount = new Map<string, number>();
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
    // Parse command into executable and args
    const parts = item.fullCmd.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc = spawn(cmd, args, {
      stdio: ['inherit', 'pipe', 'pipe']
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

  private handleExit(groupName: string, item: ProcessItem, restartPolicy: GroupConfig['restart'], code: number | null, signal: NodeJS.Signals | null): void {
    // Check if killed by easycli (don't restart if unless-stopped)
    if (restartPolicy === 'unless-stopped' && signal === 'SIGTERM') {
      return;
    }

    // Check restart policy
    if (restartPolicy === 'no') {
      return;
    }

    // Check for crash loop
    const key = `${groupName}-${item.name}`;
    const count = (this.restartCount.get(key) || 0) + 1;
    this.restartCount.set(key, count);

    if (count > this.maxRestarts) {
      console.error(`[${item.name}] Crash loop detected. Stopping restarts.`);
      return;
    }

    // Restart after delay
    setTimeout(() => {
      console.log(`[${item.name}] Restarting... (exit code: ${code})`);
      this.spawnProcess(item, groupName, restartPolicy);
    }, 1000);
  }

  killGroup(groupName: string): void {
    const processes = this.groups.get(groupName);
    if (!processes) return;

    for (const mp of processes) {
      mp.process.kill('SIGTERM');
    }

    this.groups.delete(groupName);
  }

  killAll(): void {
    for (const groupName of this.groups.keys()) {
      this.killGroup(groupName);
    }
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
