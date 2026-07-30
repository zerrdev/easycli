import { spawn, execSync, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { GroupConfig, ProcessItem } from '../config/types.js';
import { PidStore, type PidEntry } from './pid-store.js';

export type ProcessStatus = 'running' | 'restarting' | 'stopped' | 'crashed';

export interface ItemStatus {
  name: string;
  status: ProcessStatus;
  pid: number | null;
  startedAt: number | null;
  restartCount: number;
  lastExitCode: number | null;
  command: string;
}

export class ManagedProcess {
  public manuallyStopped = false;
  public startedAt: number | null = null;
  public lastExitCode: number | null = null;

  constructor(
    public item: ProcessItem,
    public process: ChildProcess | null,
    public status: ProcessStatus = 'running'
  ) {
    this.startedAt = process ? Date.now() : null;
    // An item with no process was never started, which is the same intent a
    // manual stop expresses: stay down until asked otherwise.
    this.manuallyStopped = process === null;
  }
}

export class ProcessManager extends EventEmitter {
  private groups = new Map<string, ManagedProcess[]>();
  private restartPolicies = new Map<string, GroupConfig['restart']>();
  private groupStartedAt = new Map<string, number>();
  private restartTimestamps = new Map<string, number[]>();
  private restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly maxRestarts = 3;
  private readonly restartWindow = 10000; // 10 seconds
  private readonly restartDelay = 1000;
  private readonly pidStore = new PidStore();

  /**
   * The dashboard puts the parent terminal in raw mode, so children must not
   * share that stdin or the two compete for keystrokes.
   */
  readonly childStdin: 'inherit' | 'ignore';

  constructor(options: { childStdin?: 'inherit' | 'ignore' } = {}) {
    super();
    this.childStdin = options.childStdin ?? 'inherit';
  }

  spawnGroup(
    groupName: string,
    items: ProcessItem[],
    restartPolicy: GroupConfig['restart'],
    disabledNames: string[] = []
  ): void {
    if (this.groups.has(groupName)) {
      throw new Error(`Group ${groupName} is already running`);
    }

    const processes: ManagedProcess[] = [];
    const disabled = new Set(disabledNames);

    this.restartPolicies.set(groupName, restartPolicy);
    this.groupStartedAt.set(groupName, Date.now());

    for (const item of items) {
      // Disabled items are tracked so they can be listed and started later,
      // but nothing is spawned for them now.
      if (disabled.has(item.name)) {
        processes.push(new ManagedProcess(item, null, 'stopped'));
        continue;
      }

      const proc = this.spawnProcess(item, groupName, restartPolicy);
      processes.push(new ManagedProcess(item, proc));
    }

    this.groups.set(groupName, processes);
    this.emit('group-started', groupName);
  }

  async restartGroup(groupName: string, items: ProcessItem[], restartPolicy: GroupConfig['restart']): Promise<void> {
    if (this.isGroupRunning(groupName)) {
      await this.killGroup(groupName);
    }
    this.spawnGroup(groupName, items, restartPolicy);
  }

  private spawnProcess(item: ProcessItem, groupName: string, restartPolicy: GroupConfig['restart']): ChildProcess {
    // Parse command into executable and args, handling quoted strings
    const { cmd, args } = this.parseCommand(item.fullCmd);

    const proc = spawn(cmd, args, {
      stdio: [this.childStdin, 'pipe', 'pipe'],
      // On Windows, don't use shell to avoid PID mismatch
      // The shell's PID would be stored instead of the actual process
      // For commands that need shell, user should use cmd /c prefix
      shell: false,
      windowsHide: true // Hide console window on Windows
    });

    // Write PID file when process is spawned
    // First, clean up any stale PID file for this process
    // This prevents issues with leftover PIDs from previous crashes
    this.pidStore.deletePid(groupName, item.name).catch(() => {});

    if (proc.pid) {
      const pidEntry: PidEntry = {
        pid: proc.pid,
        groupName,
        itemName: item.name,
        startTime: Date.now(),
        restartPolicy,
        fullCmd: item.fullCmd
      };
      this.pidStore.writePid(pidEntry).catch(err => {
        console.error(`[${item.name}] Failed to write PID file:`, err);
      });
    }

    // Prefix output with item name and emit events
    const emitLines = (data: Buffer, isError: boolean) => {
      const text = data.toString('utf-8');
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.length > 0) {
          this.emit('process-log', groupName, item.name, line, isError);
        }
      }
    };

    if (proc.stdout) {
      proc.stdout.on('data', (data) => emitLines(data, false));
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => emitLines(data, true));
    }

    // Handle exit and restart
    proc.on('exit', (code, signal) => {
      this.handleExit(groupName, item, restartPolicy, code, signal);
    });

    if (proc.pid) {
      this.emit('item-spawned', groupName, item.name, proc.pid);
    }

    return proc;
  }

  private findManaged(groupName: string, itemName: string): ManagedProcess | undefined {
    return this.groups.get(groupName)?.find(mp => mp.item.name === itemName);
  }

  private requireManaged(groupName: string, itemName: string): ManagedProcess {
    const managed = this.findManaged(groupName, itemName);
    if (!managed) {
      throw new Error(`Item ${itemName} not found in group ${groupName}`);
    }
    return managed;
  }

  private recentRestarts(groupName: string, itemName: string): number {
    const timestamps = this.restartTimestamps.get(`${groupName}-${itemName}`) || [];
    const now = Date.now();
    return timestamps.filter(ts => now - ts < this.restartWindow).length;
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
    // If killed by cligr via killGroup, the group is removed from the map before the kill signal is sent.
    // Don't restart processes that were intentionally stopped.
    // On Windows, TerminateProcess() results in signal=null (not 'SIGTERM'), so checking the map
    // is the only reliable cross-platform way to detect intentional kills.
    if (!this.groups.has(groupName)) {
      this.pidStore.deletePid(groupName, item.name).catch(() => {});
      return;
    }

    const managed = this.findManaged(groupName, item.name);
    if (managed) {
      managed.lastExitCode = code;
    }

    this.emit('item-exited', groupName, item.name, code, signal);

    // A manual stop suppresses the restart policy entirely, otherwise the item
    // the user just stopped would come straight back.
    if (managed?.manuallyStopped) {
      this.pidStore.deletePid(groupName, item.name).catch(() => {});
      return;
    }

    // Check restart policy
    if (restartPolicy === 'no') {
      if (managed) managed.status = 'stopped';
      // Clean up PID file when not restarting
      this.pidStore.deletePid(groupName, item.name).catch(() => {});
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
      if (managed) managed.status = 'crashed';
      // Clean up PID file when stopping due to crash loop
      this.pidStore.deletePid(groupName, item.name).catch(() => {});
      this.emit('item-crash-looped', groupName, item.name);
      return;
    }

    if (managed) managed.status = 'restarting';
    this.emit('item-restarting', groupName, item.name, this.restartDelay, recentTimestamps.length);

    // Restart after delay
    const timer = setTimeout(() => {
      this.restartTimers.delete(key);

      // The group may have been killed while the restart was pending.
      const target = this.findManaged(groupName, item.name);
      if (!target || target.manuallyStopped) {
        return;
      }

      const newProc = this.spawnProcess(item, groupName, restartPolicy);
      target.process = newProc;
      target.status = 'running';
      target.startedAt = Date.now();

      this.emit('item-restarted', groupName, item.name);
    }, this.restartDelay);

    this.restartTimers.set(key, timer);
  }

  /**
   * Drops a scheduled respawn. Without this a stop/start inside the restart
   * delay lets the old timer fire and spawn a second process on top of the
   * live one.
   */
  private cancelPendingRestart(groupName: string, itemName: string): void {
    const key = `${groupName}-${itemName}`;
    const timer = this.restartTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(key);
    }
  }

  async restartItem(groupName: string, itemName: string): Promise<void> {
    this.requireManaged(groupName, itemName);

    // A crashed item gets a genuine fresh start rather than tripping the
    // crash-loop threshold again on its first exit.
    this.restartTimestamps.delete(`${groupName}-${itemName}`);

    await this.stopItem(groupName, itemName);
    this.startItem(groupName, itemName);
  }

  async stopItem(groupName: string, itemName: string): Promise<void> {
    const managed = this.requireManaged(groupName, itemName);

    this.cancelPendingRestart(groupName, itemName);

    // Set before killing so handleExit sees it and skips the restart policy.
    managed.manuallyStopped = true;

    if (managed.process) {
      await this.killProcess(managed.process);
    }

    managed.status = 'stopped';
    managed.startedAt = null;
    await this.pidStore.deletePid(groupName, itemName).catch(() => {});

    this.emit('item-stopped', groupName, itemName);
  }

  startItem(groupName: string, itemName: string): void {
    const managed = this.requireManaged(groupName, itemName);

    if (managed.status === 'running') {
      return;
    }

    this.cancelPendingRestart(groupName, itemName);
    managed.manuallyStopped = false;
    managed.process = this.spawnProcess(managed.item, groupName, this.restartPolicies.get(groupName));
    managed.status = 'running';
    managed.startedAt = Date.now();
  }

  /** When the group was spawned. Restarting individual items does not reset it. */
  getGroupStartedAt(groupName: string): number | null {
    return this.groups.has(groupName) ? this.groupStartedAt.get(groupName) ?? null : null;
  }

  getGroupItems(groupName: string): ItemStatus[] {
    const processes = this.groups.get(groupName);
    if (!processes) return [];

    return processes.map(mp => ({
      name: mp.item.name,
      status: mp.status,
      pid: mp.status === 'running' ? mp.process?.pid ?? null : null,
      startedAt: mp.startedAt,
      restartCount: this.recentRestarts(groupName, mp.item.name),
      lastExitCode: mp.lastExitCode,
      command: mp.item.fullCmd
    }));
  }

  killGroup(groupName: string): Promise<void> {
    const processes = this.groups.get(groupName);
    if (!processes) return Promise.resolve();

    for (const mp of processes) {
      this.cancelPendingRestart(groupName, mp.item.name);
    }

    // Each item reports as it goes down so callers can show shutdown progress;
    // killing a group is not instant.
    const killPromises = processes.map(mp =>
      (mp.process ? this.killProcess(mp.process) : Promise.resolve()).then(() => {
        this.emit('item-killed', groupName, mp.item.name);
      })
    );

    this.groups.delete(groupName);

    // Clean up PID files after killing
    return Promise.all(killPromises).then(async () => {
      await this.pidStore.deleteGroupPids(groupName);
      this.emit('group-stopped', groupName);
    });
  }

  private killPid(pid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // First try SIGTERM for graceful shutdown
        process.kill(pid, 'SIGTERM');

        // Force kill with SIGKILL after 5 seconds if still running
        const timeout = setTimeout(() => {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process might have already exited
          }
        }, 5000);

        // Poll for process exit
        const checkInterval = setInterval(() => {
          if (!this.pidStore.isPidRunning(pid)) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);

        // If already dead, resolve quickly
        if (!this.pidStore.isPidRunning(pid)) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  private killProcess(proc: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (proc.exitCode !== null) {
        resolve();
        return;
      }

      if (process.platform === 'win32' && proc.pid) {
        try {
          execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true, stdio: 'pipe' });
        } catch {
          proc.kill('SIGTERM');
        }
      } else {
        proc.kill('SIGTERM');
      }

      const timeout = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 10000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  killAll(): Promise<void> {
    const killPromises: Promise<void>[] = [];
    for (const groupName of this.groups.keys()) {
      killPromises.push(this.killGroup(groupName));
    }
    return Promise.all(killPromises).then(() => {});
  }

  async cleanupStalePids(): Promise<void> {
    await this.pidStore.cleanupStalePids();
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
