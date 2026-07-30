import readline from 'readline';
import type { KeyEvent, Screen } from './dashboard.js';

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

export class TtyScreen implements Screen {
  get columns(): number {
    return process.stdout.columns ?? DEFAULT_COLUMNS;
  }

  get rows(): number {
    return process.stdout.rows ?? DEFAULT_ROWS;
  }

  write(chunk: string): void {
    process.stdout.write(chunk);
  }

  onResize(cb: () => void): void {
    process.stdout.on('resize', cb);
  }

  offResize(cb: () => void): void {
    process.stdout.off('resize', cb);
  }
}

/**
 * Raw-mode keypress capture. In raw mode Ctrl+C no longer raises SIGINT, it
 * arrives here as a keypress, so the dashboard is responsible for shutdown.
 */
export class KeyboardInput {
  private running = false;

  private readonly handler = (str: string, key: readline.Key | undefined): void => {
    this.onKey({
      name: key?.name ?? str,
      ctrl: key?.ctrl ?? false,
      shift: key?.shift ?? false
    });
  };

  constructor(private readonly onKey: (key: KeyEvent) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on('keypress', this.handler);
    process.stdin.resume();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    process.stdin.off('keypress', this.handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  }
}

/** Last-resort terminal restore, in case teardown is bypassed by a hard exit. */
export function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdout.write('\x1b[?25h');
  } catch {
    // The terminal is already gone; nothing to restore.
  }
}
