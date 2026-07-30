import { spawn, type ChildProcess } from 'child_process';
import type { ProcessItem } from '../config/types.js';
import { parseCommand, killProcess } from './spawn-utils.js';

export interface RunOnceOptions {
  /** Enabled items only, in config order. */
  items: ProcessItem[];
  sequential?: boolean;
  writeOut?: (line: string) => void;
  writeErr?: (line: string) => void;
}

interface ItemResult {
  code: number;
  spawnError?: string;
}

const SPAWN_FAILURE_CODE = 127;
const SIGNAL_FAILURE_CODE = 1;

/**
 * Runs a group's items to completion and reports a single exit code, instead of
 * supervising them the way ProcessManager does. No restarts, no PID files.
 */
export async function runOnce(options: RunOnceOptions): Promise<number> {
  const { items, sequential = false } = options;
  const writeOut = options.writeOut ?? ((line: string) => console.log(line));
  const writeErr = options.writeErr ?? ((line: string) => console.error(line));

  if (items.length === 0) return 0;

  const live = new Set<ChildProcess>();
  let abortCode: number | null = null;

  const abortWith = (code: number) => () => {
    abortCode = code;
    for (const proc of live) {
      void killProcess(proc);
    }
  };
  const onSigint = abortWith(130);
  const onSigterm = abortWith(143);

  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  /** Raw passthrough: the child owns the terminal, so colors and prompts work. */
  const runRaw = (item: ProcessItem): Promise<ItemResult> => {
    const { cmd, args } = parseCommand(item.fullCmd);

    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        stdio: 'inherit',
        shell: false,
        windowsHide: true
      });

      live.add(proc);
      settleOnce(proc, resolve, () => live.delete(proc));
    });
  };

  /** Prefixed output, so concurrent children stay tellable apart. */
  const runPiped = (item: ProcessItem): Promise<ItemResult> => {
    const { cmd, args } = parseCommand(item.fullCmd);

    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      });

      live.add(proc);

      proc.stdout?.on('data', (data: Buffer) => {
        for (const line of splitLines(data)) writeOut(`[${item.name}] ${line}`);
      });
      proc.stderr?.on('data', (data: Buffer) => {
        for (const line of splitLines(data)) writeErr(`[${item.name}] ${line}`);
      });

      settleOnce(proc, resolve, () => live.delete(proc));
    });
  };

  // `null` marks an item that never ran because a sequential run stopped early.
  const results: (ItemResult | null)[] = items.map(() => null);

  try {
    if (sequential) {
      const showHeaders = items.length > 1;

      for (let i = 0; i < items.length; i++) {
        if (abortCode !== null) break;
        if (showHeaders) writeErr(`→ ${items[i].name}`);

        const result = await runRaw(items[i]);
        results[i] = result;

        if (result.code !== 0) break;
      }
    } else if (items.length === 1) {
      results[0] = await runRaw(items[0]);
    } else {
      const settled = await Promise.all(items.map(runPiped));
      settled.forEach((result, i) => { results[i] = result; });
    }
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }

  if (abortCode !== null) return abortCode;

  return reportAndPickExitCode(items, results, writeErr);
}

function settleOnce(
  proc: ChildProcess,
  resolve: (result: ItemResult) => void,
  cleanup: () => void
): void {
  let settled = false;

  const settle = (result: ItemResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(result);
  };

  // A failed spawn emits 'error' and may never emit 'exit'.
  proc.on('error', (err) => {
    settle({ code: SPAWN_FAILURE_CODE, spawnError: err.message });
  });

  proc.on('exit', (code) => {
    // A child killed by a signal reports a null code; that is still a failure.
    settle({ code: code ?? SIGNAL_FAILURE_CODE });
  });
}

function splitLines(data: Buffer): string[] {
  return data.toString('utf-8').split('\n').filter(line => line.length > 0);
}

function reportAndPickExitCode(
  items: ProcessItem[],
  results: (ItemResult | null)[],
  writeErr: (line: string) => void
): number {
  let exitCode = 0;

  for (let i = 0; i < items.length; i++) {
    const result = results[i];
    if (!result || result.code === 0) continue;

    if (result.spawnError) {
      writeErr(`cligr: ${items[i].name} failed to start: ${result.spawnError}`);
    } else {
      writeErr(`cligr: ${items[i].name} exited with code ${result.code}`);
    }

    // First failure in config order wins, regardless of finishing order.
    if (exitCode === 0) exitCode = result.code;
  }

  return exitCode;
}
