import type { ItemStatus, ProcessStatus } from '../process/manager.js';

export interface RenderModel {
  groupName: string;
  items: ItemStatus[];
  selectedIndex: number;
  filterItem: string | null;
  groupStartedAt: number | null;
  showCommand: boolean;
  now: number;
  ascii: boolean;
  color: boolean;
}

interface Glyphs {
  running: string;
  restarting: string;
  stopped: string;
  crashed: string;
  separator: string;
  bullet: string;
  selected: string;
  unselected: string;
  moreAbove: string;
  moreBelow: string;
  times: string;
  done: string;
}

const UNICODE: Glyphs = {
  running: '●',
  restarting: '↻',
  stopped: '○',
  crashed: '✕',
  separator: '─',
  bullet: '·',
  selected: '›',
  unselected: ' ',
  moreAbove: '↑',
  moreBelow: '↓',
  times: '×',
  done: '✓'
};

const ASCII: Glyphs = {
  running: '[*]',
  restarting: '[~]',
  stopped: '[ ]',
  crashed: '[x]',
  separator: '-',
  bullet: '-',
  selected: '>',
  unselected: ' ',
  moreAbove: '^',
  moreBelow: 'v',
  times: 'x',
  done: '[v]'
};

const RESET = '\x1b[0m';

const STATUS_COLOR: Record<ProcessStatus, string> = {
  running: '\x1b[32m',
  restarting: '\x1b[33m',
  stopped: '\x1b[2m',
  crashed: '\x1b[31m'
};

const DIM = '\x1b[2m';

const STATUS_ORDER: ProcessStatus[] = ['running', 'restarting', 'stopped', 'crashed'];

const STATUS_WIDTH = 'restarting'.length;
const MAX_NAME_WIDTH = 20;

/** Rows consumed by the separator, header, hint line, and a minimum of log context. */
const CHROME_ROWS = 6;

export function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}m`;
}

function truncate(line: string, max: number): string {
  return line.length <= max ? line : line.slice(0, max);
}

function paint(text: string, color: string, useColor: boolean): string {
  return useColor ? `${color}${text}${RESET}` : text;
}

function detailFor(item: ItemStatus, glyphs: Glyphs): string {
  const parts: string[] = [];
  if (item.restartCount > 0) {
    parts.push(`${glyphs.times}${item.restartCount}`);
  }
  if (item.lastExitCode !== null) {
    parts.push(`exit ${item.lastExitCode}`);
  }
  return parts.join('  ');
}

function buildHeader(model: RenderModel, glyphs: Glyphs): string {
  const counts = new Map<ProcessStatus, number>();
  for (const item of model.items) {
    counts.set(item.status, (counts.get(item.status) || 0) + 1);
  }

  const summary = STATUS_ORDER.filter(s => (counts.get(s) || 0) > 0)
    .map(s => `${glyphs[s]} ${counts.get(s)} ${s}`)
    .join('  ');

  let header = ` ${model.groupName}`;
  if (model.groupStartedAt !== null) {
    header += ` ${glyphs.bullet} up ${formatUptime(model.now - model.groupStartedAt)}`;
  }
  header += ` ${glyphs.bullet} ${summary}`;

  if (model.filterItem) {
    header += `  ${glyphs.bullet} filter: ${model.filterItem}`;
  }
  return header;
}

function windowStart(model: RenderModel, maxRows: number): number {
  if (model.items.length <= maxRows) {
    return 0;
  }

  const centered = model.selectedIndex - Math.floor(maxRows / 2);
  return Math.min(Math.max(0, centered), model.items.length - maxRows);
}

function buildItemRows(model: RenderModel, glyphs: Glyphs, maxRows: number, nameWidth: number): Array<{ text: string; color: string }> {
  const start = windowStart(model, maxRows);
  const end = Math.min(model.items.length, start + maxRows);

  const rows = model.items.slice(start, end).map((item, offset) => {
    const index = start + offset;
    const marker = index === model.selectedIndex ? glyphs.selected : glyphs.unselected;
    const name = item.name.padEnd(nameWidth);
    const statusWord = item.status.padEnd(STATUS_WIDTH);
    const detail = detailFor(item, glyphs);

    return {
      text: `${marker}${glyphs[item.status]} ${name} ${statusWord} ${detail}`.trimEnd(),
      color: STATUS_COLOR[item.status]
    };
  });

  if (start > 0 && rows.length > 0) {
    rows[0] = { text: ` ${glyphs.moreAbove} ${start} more`, color: DIM };
  }

  const hiddenBelow = model.items.length - end;
  if (hiddenBelow > 0 && rows.length > 0) {
    rows[rows.length - 1] = { text: ` ${glyphs.moreBelow} ${hiddenBelow} more`, color: DIM };
  }

  return rows;
}

function buildHint(glyphs: Glyphs): string {
  const select = `[${glyphs.moreAbove}${glyphs.moreBelow}] select`;
  return ` ${select}  [r] restart  [s] stop  [f] filter  [v] cmd  [R] group  [q] quit`;
}

function buildCommandLine(model: RenderModel): { text: string; color: string } | null {
  const selected = model.items[model.selectedIndex];
  if (!selected) {
    return null;
  }

  return { text: ` $ ${selected.command}`, color: DIM };
}

export interface ShutdownModel {
  groupName: string;
  items: Array<{ name: string; stopped: boolean }>;
  ascii: boolean;
  color: boolean;
}

export function renderShutdown(model: ShutdownModel, width: number): string[] {
  const glyphs = model.ascii ? ASCII : UNICODE;
  const max = Math.max(1, width - 1);

  const done = model.items.filter(i => i.stopped).length;
  const nameWidth = model.items.length
    ? Math.min(MAX_NAME_WIDTH, Math.max(...model.items.map(i => i.name.length)))
    : 0;

  const header = {
    text: `Stopping ${model.groupName}... ${done}/${model.items.length}`,
    color: DIM
  };

  const rows = model.items.map(item => ({
    text: item.stopped
      ? ` ${glyphs.done} ${item.name.padEnd(nameWidth)} stopped`
      : ` ${glyphs.restarting} ${item.name.padEnd(nameWidth)} stopping`,
    color: item.stopped ? STATUS_COLOR.running : STATUS_COLOR.restarting
  }));

  return [header, ...rows].map(line => paint(truncate(line.text, max), line.color, model.color));
}

export function render(model: RenderModel, width: number, height: number): string[] {
  const glyphs = model.ascii ? ASCII : UNICODE;
  const max = Math.max(1, width - 1);

  const commandLine = model.showCommand ? buildCommandLine(model) : null;

  // The command line takes its row from the item list rather than growing the
  // footer, so toggling it does not push logs off the screen.
  const maxRows = Math.max(1, height - CHROME_ROWS - (commandLine ? 1 : 0));

  const nameWidth = model.items.length
    ? Math.min(MAX_NAME_WIDTH, Math.max(...model.items.map(i => i.name.length)))
    : 0;

  const lines: Array<{ text: string; color: string }> = [
    { text: glyphs.separator.repeat(max), color: DIM },
    { text: buildHeader(model, glyphs), color: DIM },
    ...buildItemRows(model, glyphs, maxRows, nameWidth),
    ...(commandLine ? [commandLine] : []),
    { text: buildHint(glyphs), color: DIM }
  ];

  return lines.map(line => paint(truncate(line.text, max), line.color, model.color));
}
