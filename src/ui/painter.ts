import { createLogUpdate } from 'log-update';
import type { Screen } from './dashboard.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * log-update reads the width, height and TTY-ness of the stream it writes to,
 * so the screen is adapted to the little of a stream it actually touches.
 */
function asStream(screen: Screen): NodeJS.WritableStream {
  return {
    write: (chunk: string) => {
      screen.write(chunk);
      return true;
    },
    get columns() {
      return screen.columns;
    },
    get rows() {
      return screen.rows;
    },
    // The dashboard only runs on a TTY; log-update uses this to wrap each
    // repaint in a synchronized update.
    isTTY: true
  } as unknown as NodeJS.WritableStream;
}

/**
 * Owns the pinned footer and the count of lines it last painted. Every write
 * to the terminal goes through here so the footer is always repainted below
 * whatever else was written.
 *
 * Repainting is delegated to log-update rather than hand-rolled cursor
 * arithmetic: it diffs consecutive frames, counts the physical rows a frame
 * occupies once wrapped to the terminal width, and emits the repaint as a
 * synchronized update. Moving the cursor up and overwriting the block in place
 * is correct by the spec and works in most terminals, but Tabby renders each
 * repaint two rows lower than asked, stranding the top of every frame.
 */
export class Painter {
  private painted = 0;
  private readonly render: ReturnType<typeof createLogUpdate>;

  constructor(private readonly screen: Screen) {
    // The dashboard hides and shows the cursor around its own lifetime, so
    // log-update must not also take it upon itself.
    this.render = createLogUpdate(asStream(screen), { showCursor: true });
  }

  get paintedLines(): number {
    return this.painted;
  }

  paint(lines: string[]): void {
    this.flush([], lines);
  }

  /** Writes queued log lines above the footer, then repaints the footer. */
  flush(logLines: string[], footerLines: string[]): void {
    if (logLines.length === 0 && footerLines.length === 0) {
      this.erase();
      return;
    }

    // Log lines are permanent: they take over the rows the footer occupied and
    // stay in the scrollback, and the footer is drawn again below them.
    if (logLines.length > 0) {
      this.render.persist(logLines.join('\n'));
      this.painted = 0;
    }

    if (footerLines.length > 0) {
      this.render(footerLines.join('\n'));
    }

    this.painted = footerLines.length;
  }

  erase(): void {
    if (this.painted === 0) {
      return;
    }

    this.render.clear();
    this.painted = 0;
  }

  hideCursor(): void {
    this.screen.write(HIDE_CURSOR);
  }

  showCursor(): void {
    this.screen.write(SHOW_CURSOR);
  }

  /** Drops the painted block without emitting escapes, for use after a resize. */
  reset(): void {
    this.render.done();
    this.painted = 0;
  }
}
