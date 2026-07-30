import type { Screen } from './dashboard.js';
import { Painter } from './painter.js';
import { renderShutdown } from './renderer.js';

export interface ShutdownViewOptions {
  screen: Screen;
  groupName: string;
  items: string[];
  ascii?: boolean;
  color?: boolean;
}

/**
 * Progress for a group shutdown. Killing a group waits on each child to exit,
 * which can take seconds, so the terminal reports what it is waiting for
 * instead of going silent.
 */
export class ShutdownView {
  private readonly screen: Screen;
  private readonly groupName: string;
  private readonly ascii: boolean;
  private readonly color: boolean;
  private readonly painter: Painter;
  private readonly items: Array<{ name: string; stopped: boolean }>;

  constructor(options: ShutdownViewOptions) {
    this.screen = options.screen;
    this.groupName = options.groupName;
    this.ascii = options.ascii ?? false;
    this.color = options.color ?? false;
    this.items = options.items.map(name => ({ name, stopped: false }));
    this.painter = new Painter(chunk => this.screen.write(chunk));
  }

  start(): void {
    this.painter.hideCursor();
    this.repaint();
  }

  markStopped(itemName: string): void {
    const item = this.items.find(i => i.name === itemName);
    if (!item || item.stopped) {
      return;
    }

    item.stopped = true;
    this.repaint();
  }

  /** Paints the final state and leaves it in the scrollback. */
  finish(): void {
    this.repaint();
    this.painter.reset();
    this.painter.showCursor();
    // Ends the row so the final state stays put instead of being overwritten.
    this.screen.write('\n');
  }

  private repaint(): void {
    this.painter.paint(
      renderShutdown(
        {
          groupName: this.groupName,
          items: this.items,
          ascii: this.ascii,
          color: this.color
        },
        this.screen.columns
      )
    );
  }
}
