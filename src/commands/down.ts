import { ProcessManager } from '../process/manager.js';

export async function downCommand(groupName: string): Promise<number> {
  const manager = new ProcessManager();

  // Check for PID files and kill processes
  const result = await manager.killGroupByPid(groupName);

  if (result.killed === 0 && result.notRunning === 0) {
    console.log(`Group '${groupName}' is not running`);
    return 0;
  }

  if (result.killed > 0) {
    console.log(`Stopped ${result.killed} process(es) for group '${groupName}'`);
  }

  if (result.notRunning > 0) {
    console.log(`Cleaned up ${result.notRunning} stale PID file(s) for group '${groupName}'`);
  }

  if (result.errors.length > 0) {
    console.error('Errors while stopping processes:');
    for (const err of result.errors) {
      console.error(`  ${err}`);
    }
    return 1;
  }

  return 0;
}
