import type { ItemStatus, ProcessManager } from '../process/manager.js';
import { Painter } from './painter.js';
import { render, renderBanner, type RenderModel } from './renderer.js';

export interface Screen {
  readonly columns: number;
  readonly rows: number;
  write(chunk: string): void;
  onResize(cb: () => void): void;
  offResize(cb: () => void): void;
}

export interface KeyEvent {
  name: string;
  ctrl?: boolean;
  shift?: boolean;
}

export interface DashboardOptions {
  manager: ProcessManager;
  groupName: string;
  screen: Screen;
  ascii?: boolean;
  color?: boolean;
  now?: () => number;
  renderIntervalMs?: number;
  onQuit?: () => void;
}

const DEFAULT_RENDER_INTERVAL_MS = 50;
const MAX_CONSECUTIVE_RENDER_FAILURES = 3;

/** How much of each item's output is kept for the focused view to replay. */
const HISTORY_LINES = 50;

/** How much of that history a failure reports. */
const FAILURE_TAIL_LINES = 20;

function lineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

interface ItemHistory {
  /** The retained lines, oldest first, at most HISTORY_LINES of them. */
  lines: string[];
  /** Every line ever seen, so positions stay stable as the window slides. */
  produced: number;
  /** Position a previous failure reported up to, so crash loops do not repeat. */
  failureReportedUpTo: number;
}

export class Dashboard {
  private readonly manager: ProcessManager;
  private readonly groupName: string;
  private readonly screen: Screen;
  private readonly painter: Painter;
  private readonly ascii: boolean;
  private readonly color: boolean;
  private readonly now: () => number;
  private readonly renderIntervalMs: number;
  private readonly onQuit: () => void;

  private selection = 0;
  private filter: string | null = null;
  private commandVisible = false;
  private pendingLogs: string[] = [];
  private lastPainted = '';
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private renderFailures = 0;
  private readonly history = new Map<string, ItemHistory>();

  /**
   * Every line is recorded, but only the item being followed reaches the
   * terminal. A group of twenty services produces far more output than a
   * terminal can scroll, and that flood is what makes the dashboard feel
   * frozen; keeping the lines back means focusing an item can still show where
   * it has been, and a failure can still explain itself.
   */
  private readonly onLog = (group: string, itemName: string, line: string, _isError: boolean): void => {
    if (group !== this.groupName) return;

    const history = this.historyFor(itemName);
    history.lines.push(line);
    history.produced++;
    if (history.lines.length > HISTORY_LINES) {
      history.lines.shift();
    }

    if (this.filter === itemName) {
      this.pendingLogs.push(`[${itemName}] ${line}`);
    }
  };

  private readonly onFailed = (group: string, itemName: string, code: number | null): void => {
    if (group !== this.groupName) return;

    const history = this.history.get(itemName);
    if (history === undefined) return;

    const oldestRetained = history.produced - history.lines.length;
    // Never re-reports what an earlier failure already showed, so a crash loop
    // reports each attempt's own output rather than repeating the first.
    const from = Math.max(history.produced - FAILURE_TAIL_LINES, history.failureReportedUpTo, oldestRetained);
    const count = history.produced - from;
    history.failureReportedUpTo = history.produced;

    if (count <= 0) return;

    this.pushBanner(itemName, `last ${lineCount(count)} before exit ${code ?? 'signal'}`);
    for (let i = from - oldestRetained; i < history.lines.length; i++) {
      this.pendingLogs.push(`[${itemName}] ${history.lines[i]}`);
    }
  };

  private readonly onResize = (): void => {
    // The terminal has already reflowed the old footer, so its line count is no
    // longer trustworthy — drop it and repaint from scratch.
    this.painter.reset();
    this.lastPainted = '';
  };

  constructor(options: DashboardOptions) {
    this.manager = options.manager;
    this.groupName = options.groupName;
    this.screen = options.screen;
    this.ascii = options.ascii ?? false;
    this.color = options.color ?? false;
    this.now = options.now ?? (() => Date.now());
    this.renderIntervalMs = options.renderIntervalMs ?? DEFAULT_RENDER_INTERVAL_MS;
    this.onQuit = options.onQuit ?? (() => {});
    this.painter = new Painter(this.screen);
  }

  get selectedIndex(): number {
    return this.selection;
  }

  get filterItem(): string | null {
    return this.filter;
  }

  get showCommand(): boolean {
    return this.commandVisible;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.manager.on('process-log', this.onLog);
    this.manager.on('item-failed', this.onFailed);
    this.screen.onResize(this.onResize);
    this.painter.hideCursor();

    if (this.renderIntervalMs > 0) {
      this.timer = setInterval(() => this.tick(), this.renderIntervalMs);
      this.timer.unref?.();
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.manager.off('process-log', this.onLog);
    this.manager.off('item-failed', this.onFailed);
    this.screen.offResize(this.onResize);

    this.painter.erase();
    this.painter.showCursor();
    this.pendingLogs = [];
    this.history.clear();
    this.lastPainted = '';
  }

  tick(): void {
    if (!this.running) return;

    try {
      const footer = render(this.buildModel(), this.screen.columns, this.screen.rows);
      const signature = footer.join('\n');

      if (this.pendingLogs.length === 0 && signature === this.lastPainted) {
        return;
      }

      const logs = this.pendingLogs;
      this.pendingLogs = [];

      this.painter.flush(logs, footer);
      this.lastPainted = signature;
      this.renderFailures = 0;
    } catch (err) {
      this.handleRenderFailure(err);
    }
  }

  async handleKey(key: KeyEvent): Promise<void> {
    if (!this.running) return;

    if (key.ctrl && key.name === 'c') {
      this.onQuit();
      return;
    }

    switch (key.name) {
      case 'up':
      case 'k':
        this.moveSelection(-1);
        return;
      case 'down':
      case 'j':
        this.moveSelection(1);
        return;
      case 'f':
        this.toggleFilter();
        return;
      case 'v':
        this.commandVisible = !this.commandVisible;
        return;
      case 'q':
        this.onQuit();
        return;
      case 'r':
        await (key.shift ? this.restartGroup() : this.restartSelected());
        return;
      case 's':
        await this.toggleSelected();
        return;
      default:
    }
  }

  private items(): ItemStatus[] {
    return this.manager.getGroupItems(this.groupName);
  }

  private selected(): ItemStatus | undefined {
    return this.items()[this.selection];
  }

  private buildModel(): RenderModel {
    const items = this.items();
    return {
      groupName: this.groupName,
      items,
      selectedIndex: Math.min(this.selection, Math.max(0, items.length - 1)),
      filterItem: this.filter,
      groupStartedAt: this.manager.getGroupStartedAt(this.groupName),
      showCommand: this.commandVisible,
      now: this.now(),
      ascii: this.ascii,
      color: this.color
    };
  }

  private moveSelection(delta: number): void {
    const count = this.items().length;
    if (count === 0) {
      this.selection = 0;
      return;
    }
    this.selection = Math.min(Math.max(0, this.selection + delta), count - 1);
  }

  private toggleFilter(): void {
    const selected = this.selected();
    if (!selected) return;

    if (this.filter === selected.name) {
      this.filter = null;
      return;
    }

    this.filter = selected.name;
    this.replayHistory(selected.name);
  }

  /** Writes out what the item has said so far, so focusing it is not a blank start. */
  private replayHistory(itemName: string): void {
    const history = this.history.get(itemName);
    if (history === undefined || history.lines.length === 0) return;

    this.pushBanner(itemName, `last ${lineCount(history.lines.length)}`);
    for (const line of history.lines) {
      this.pendingLogs.push(`[${itemName}] ${line}`);
    }
    // The live stream repeats the same prefix as the replay, so without a
    // closing rule the two read as one continuous block.
    this.pushBanner(itemName, 'following');
  }

  private pushBanner(itemName: string, detail: string): void {
    this.pendingLogs.push(renderBanner(itemName, detail, this.screen.columns, this.ascii, this.color));
  }

  private historyFor(itemName: string): ItemHistory {
    const existing = this.history.get(itemName);
    if (existing !== undefined) return existing;

    const created: ItemHistory = { lines: [], produced: 0, failureReportedUpTo: 0 };
    this.history.set(itemName, created);
    return created;
  }

  private async restartSelected(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;
    await this.manager.restartItem(this.groupName, selected.name);
  }

  private async restartGroup(): Promise<void> {
    const names = this.items().map(i => i.name);
    await Promise.all(names.map(name => this.manager.restartItem(this.groupName, name)));
  }

  private async toggleSelected(): Promise<void> {
    const selected = this.selected();
    if (!selected) return;

    if (selected.status === 'running' || selected.status === 'restarting') {
      await this.manager.stopItem(this.groupName, selected.name);
    } else {
      await this.manager.startItem(this.groupName, selected.name);
    }
  }

  private handleRenderFailure(err: unknown): void {
    this.renderFailures++;

    if (this.renderFailures < MAX_CONSECUTIVE_RENDER_FAILURES) {
      return;
    }

    // Rendering is broken; drop back to plain logging rather than taking
    // process supervision down with the display.
    const message = err instanceof Error ? err.message : String(err);
    this.stop();
    this.screen.write(`Dashboard disabled after render failures: ${message}\n`);
  }
}
