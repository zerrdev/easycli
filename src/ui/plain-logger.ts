import type { ProcessManager } from '../process/manager.js';

export interface PlainLoggerOptions {
  manager: ProcessManager;
  groupName: string;
  writeOut?: (line: string) => void;
  writeErr?: (line: string) => void;
}

/**
 * Terminal output for the non-TTY path. Reproduces the prefixed, scrolling
 * output cligr produced before the dashboard existed.
 */
export class PlainLogger {
  private readonly manager: ProcessManager;
  private readonly groupName: string;
  private readonly writeOut: (line: string) => void;
  private readonly writeErr: (line: string) => void;
  private readonly lastExitCodes = new Map<string, number | null>();
  private running = false;

  private readonly onLog = (group: string, itemName: string, line: string, isError: boolean): void => {
    if (group !== this.groupName) return;
    const write = isError ? this.writeErr : this.writeOut;
    write(`[${itemName}] ${line}`);
  };

  private readonly onExited = (group: string, itemName: string, code: number | null): void => {
    if (group !== this.groupName) return;
    this.lastExitCodes.set(itemName, code);
  };

  private readonly onRestarting = (group: string, itemName: string): void => {
    if (group !== this.groupName) return;
    const code = this.lastExitCodes.get(itemName) ?? null;
    this.writeOut(`[${itemName}] Restarting... (exit code: ${code})`);
  };

  private readonly onCrashLooped = (group: string, itemName: string): void => {
    if (group !== this.groupName) return;
    this.writeErr(`[${itemName}] Crash loop detected. Stopping restarts.`);
  };

  constructor(options: PlainLoggerOptions) {
    this.manager = options.manager;
    this.groupName = options.groupName;
    this.writeOut = options.writeOut ?? (line => console.log(line));
    this.writeErr = options.writeErr ?? (line => console.error(line));
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.manager.on('process-log', this.onLog);
    this.manager.on('item-exited', this.onExited);
    this.manager.on('item-restarting', this.onRestarting);
    this.manager.on('item-crash-looped', this.onCrashLooped);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.manager.off('process-log', this.onLog);
    this.manager.off('item-exited', this.onExited);
    this.manager.off('item-restarting', this.onRestarting);
    this.manager.off('item-crash-looped', this.onCrashLooped);
  }
}
