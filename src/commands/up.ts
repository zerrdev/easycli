import { ConfigLoader } from '../config/loader.js';
import type { ProcessItem } from '../config/types.js';
import { TemplateExpander } from '../process/template.js';
import { ProcessManager } from '../process/manager.js';
import { PidStore } from '../process/pid-store.js';
import { runOnce } from '../process/one-shot.js';
import { Dashboard } from '../ui/dashboard.js';
import { PlainLogger } from '../ui/plain-logger.js';
import { ShutdownView } from '../ui/shutdown.js';
import { shouldUseColor, shouldUseDashboard } from '../ui/activation.js';
import { KeyboardInput, TtyScreen, restoreTerminal } from '../ui/tty.js';

export interface UpOptions {
  noUi?: boolean;
  ascii?: boolean;
}

export async function upCommand(groupName: string, options: UpOptions = {}): Promise<number> {
  const loader = new ConfigLoader();

  try {
    const { items, disabledNames, tool, toolTemplate, params, restart, mode, sequential, separator } =
      loader.getGroup(groupName);

    const repeating = toolTemplate !== null && TemplateExpander.hasRepeatingBlock(toolTemplate);

    // A repeating template folds the whole group into one process, so its
    // disabled items are left out of the command rather than tracked as rows.
    const enabled = items.filter(item => !disabledNames.includes(item.name));

    if (repeating && enabled.length === 0) {
      console.error(`cligr: group ${groupName} has no enabled items`);
      return 1;
    }

    const processItems = repeating
      ? [TemplateExpander.expandRepeating(toolTemplate!, groupName, enabled, separator, params)]
      : items.map((item, index) => TemplateExpander.parseItem(tool, toolTemplate, item, index, params));

    const stoppedNames = repeating ? [] : disabledNames;

    if (mode === 'once') {
      return runOneShot(groupName, processItems, stoppedNames, sequential);
    }

    // Only a supervised run tracks PIDs, so only it needs the stale sweep.
    const pidStore = new PidStore();
    await pidStore.cleanupStalePids();

    const useDashboard = shouldUseDashboard({
      isTTY: Boolean(process.stdout.isTTY),
      noUi: options.noUi ?? false,
      rows: process.stdout.rows ?? 0
    });

    const manager = new ProcessManager({
      childStdin: useDashboard ? 'ignore' : 'inherit'
    });

    manager.spawnGroup(groupName, processItems, restart, stoppedNames);

    const startedCount = processItems.length - stoppedNames.length;
    const disabledNote = stoppedNames.length ? `, ${stoppedNames.length} disabled` : '';
    console.log(`Started group ${groupName} with ${startedCount} process(es)${disabledNote}`);

    return useDashboard
      ? runWithDashboard(manager, groupName, options)
      : runPlain(manager, groupName);
  } catch (error) {
    if (error instanceof Error && error.name === 'ConfigError') {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

function runOneShot(
  groupName: string,
  processItems: ProcessItem[],
  disabledNames: string[],
  sequential: boolean
): Promise<number> {
  const disabled = new Set(disabledNames);
  const enabled = processItems.filter(item => !disabled.has(item.name));

  if (enabled.length === 0) {
    console.error(`cligr: group ${groupName} has no enabled items`);
    return Promise.resolve(0);
  }

  return runOnce({ items: enabled, sequential });
}

function runPlain(manager: ProcessManager, groupName: string): Promise<number> {
  const logger = new PlainLogger({ manager, groupName });
  logger.start();

  console.log('Press Ctrl+C to stop...');

  return new Promise((resolve) => {
    const cleanup = async () => {
      console.log('\nShutting down...');
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      logger.stop();
      await manager.killAll();
      resolve(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}

function runWithDashboard(
  manager: ProcessManager,
  groupName: string,
  options: UpOptions
): Promise<number> {
  const screen = new TtyScreen();
  const useColor = shouldUseColor({
    isTTY: Boolean(process.stdout.isTTY),
    noColor: Boolean(process.env.NO_COLOR)
  });

  return new Promise((resolve) => {
    let tornDown = false;

    const teardown = async () => {
      if (tornDown) return;
      tornDown = true;

      process.removeListener('SIGTERM', teardown);
      process.removeListener('exit', restoreTerminal);

      keyboard.stop();
      const itemNames = manager.getGroupItems(groupName).map(i => i.name);
      dashboard.stop();

      // Killing a group waits on every child to exit, so report progress
      // rather than leaving the terminal silent until it finishes.
      const shutdown = new ShutdownView({
        screen,
        groupName,
        items: itemNames,
        ascii: options.ascii ?? false,
        color: useColor
      });
      const onKilled = (group: string, itemName: string) => {
        if (group === groupName) shutdown.markStopped(itemName);
      };

      manager.on('item-killed', onKilled);
      shutdown.start();

      try {
        await manager.killAll();
      } finally {
        manager.off('item-killed', onKilled);
        shutdown.finish();
      }

      resolve(0);
    };

    const dashboard = new Dashboard({
      manager,
      groupName,
      screen,
      ascii: options.ascii ?? false,
      color: useColor,
      onQuit: () => {
        void teardown();
      }
    });

    const keyboard = new KeyboardInput((key) => {
      dashboard.handleKey(key).catch(() => {
        // A failed control action must not take the dashboard down.
      });
    });

    // In raw mode Ctrl+C arrives as a keypress rather than SIGINT, so the
    // dashboard drives shutdown; SIGTERM is still handled here.
    process.on('SIGTERM', teardown);
    process.on('exit', restoreTerminal);

    dashboard.start();
    keyboard.start();
  });
}
