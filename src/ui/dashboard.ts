import type { ItemStatus, ProcessManager } from '../process/manager.js';
import { Painter } from './painter.js';
import { render, type RenderModel } from './renderer.js';

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

  private readonly onLog = (group: string, itemName: string, line: string, _isError: boolean): void => {
    if (group !== this.groupName) return;
    if (this.filter !== null && this.filter !== itemName) return;
    this.pendingLogs.push(`[${itemName}] ${line}`);
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
    this.painter = new Painter(chunk => this.screen.write(chunk));
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
    this.screen.offResize(this.onResize);

    this.painter.erase();
    this.painter.showCursor();
    this.pendingLogs = [];
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
    this.filter = this.filter === selected.name ? null : selected.name;
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
      this.manager.startItem(this.groupName, selected.name);
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
