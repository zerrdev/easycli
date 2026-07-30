/**
 * Tests for the shutdown progress view.
 *
 * Killing a group can take seconds — killProcess waits for each child to exit
 * and only force-kills after a timeout. Without progress the terminal goes
 * silent for that whole window, which reads as a hang.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { renderShutdown } from '../../src/ui/renderer.js';
import { ShutdownView } from '../../src/ui/shutdown.js';
import type { Screen } from '../../src/ui/dashboard.js';

class FakeScreen implements Screen {
  columns = 60;
  rows = 24;
  chunks: string[] = [];
  write(chunk: string): void { this.chunks.push(chunk); }
  onResize(): void {}
  offResize(): void {}
  get text(): string { return this.chunks.join(''); }
  clear(): void { this.chunks = []; }
}

describe('renderShutdown', () => {
  const model = (overrides: Partial<Parameters<typeof renderShutdown>[0]> = {}) => ({
    groupName: 'demo',
    items: [
      { name: 'api', stopped: true },
      { name: 'worker', stopped: false }
    ],
    ascii: false,
    color: false,
    ...overrides
  });

  it('should show the group name and how many have stopped', () => {
    const lines = renderShutdown(model(), 60);

    assert.match(lines[0], /demo/);
    assert.match(lines[0], /1\/2/);
  });

  it('should show a row per item', () => {
    const lines = renderShutdown(model(), 60);

    assert.strictEqual(lines.length, 3);
    assert.match(lines[1], /api/);
    assert.match(lines[2], /worker/);
  });

  it('should distinguish stopped items from ones still stopping', () => {
    const lines = renderShutdown(model(), 60);

    assert.match(lines[1], /stopped/);
    assert.match(lines[2], /stopping/);
  });

  it('should mark progress complete when every item has stopped', () => {
    const lines = renderShutdown(
      model({ items: [{ name: 'api', stopped: true }, { name: 'worker', stopped: true }] }),
      60
    );

    assert.match(lines[0], /2\/2/);
  });

  it('should use ascii glyphs when asked', () => {
    const lines = renderShutdown(model({ ascii: true }), 60);

    for (const line of lines) {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(line, /[^\x00-\x7F]/, `non-ascii in: ${line}`);
    }
  });

  it('should keep every line inside the terminal width', () => {
    const lines = renderShutdown(
      model({ items: [{ name: 'a-really-long-item-name-that-overflows-the-line', stopped: false }] }),
      30
    );

    for (const line of lines) {
      assert.ok(line.length <= 29, `line of ${line.length} exceeds width-1`);
    }
  });

  it('should emit no escape sequences when color is off', () => {
    const lines = renderShutdown(model(), 60);

    for (const line of lines) {
      assert.ok(!line.includes('\x1b['), `unexpected SGR in ${JSON.stringify(line)}`);
    }
  });

  it('should emit escape sequences when color is on', () => {
    const lines = renderShutdown(model({ color: true }), 60);

    assert.ok(lines.some(l => l.includes('\x1b[')));
  });
});

describe('ShutdownView', () => {
  let screen: FakeScreen;
  let view: ShutdownView;

  beforeEach(() => {
    screen = new FakeScreen();
    view = new ShutdownView({ screen, groupName: 'demo', items: ['api', 'worker'] });
  });

  it('should paint every item as stopping on start', () => {
    view.start();

    assert.ok(screen.text.includes('api'));
    assert.ok(screen.text.includes('worker'));
    assert.ok(screen.text.includes('stopping'));
  });

  it('should show zero progress on start', () => {
    view.start();

    assert.ok(screen.text.includes('0/2'));
  });

  it('should advance progress as items stop', () => {
    view.start();
    screen.clear();

    view.markStopped('api');

    assert.ok(screen.text.includes('1/2'));
  });

  it('should reach full progress when all items stop', () => {
    view.start();
    view.markStopped('api');
    screen.clear();

    view.markStopped('worker');

    assert.ok(screen.text.includes('2/2'));
  });

  it('should ignore an unknown item name', () => {
    view.start();
    screen.clear();

    view.markStopped('ghost');

    assert.ok(!screen.text.includes('1/2'));
  });

  it('should ignore a repeated item name', () => {
    view.start();
    view.markStopped('api');
    screen.clear();

    view.markStopped('api');

    assert.ok(!screen.text.includes('2/2'), 'the same item must not count twice');
  });

  it('should leave the final state in the scrollback', () => {
    view.start();
    view.markStopped('api');
    view.markStopped('worker');
    screen.clear();

    view.finish();

    assert.ok(screen.text.endsWith('\n'), 'output must end its row so it stays put');
  });

  it('should restore the cursor when finished', () => {
    view.start();
    screen.clear();

    view.finish();

    assert.ok(screen.text.includes('\x1b[?25h'));
  });

  it('should hide the cursor while repainting', () => {
    view.start();

    assert.ok(screen.text.includes('\x1b[?25l'));
  });

  it('should tolerate finishing without any progress', () => {
    view.start();

    view.finish();
  });

  it('should tolerate an empty item list', () => {
    const empty = new ShutdownView({ screen, groupName: 'demo', items: [] });

    empty.start();
    empty.finish();

    assert.ok(screen.text.includes('demo'));
  });
});
