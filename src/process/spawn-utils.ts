import { execSync, type ChildProcess } from 'child_process';

/**
 * Splits a command line into executable and arguments, honouring quotes so
 * Windows paths with spaces survive.
 */
export function parseCommand(fullCmd: string): { cmd: string; args: string[] } {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < fullCmd.length; i++) {
    const char = fullCmd[i];

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return { cmd: args[0] || '', args: args.slice(1) };
}

/**
 * Terminates a child and resolves once it is gone. On Windows taskkill /T is
 * the only reliable way to take the whole process tree down.
 */
export function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve();
      return;
    }

    if (process.platform === 'win32' && proc.pid) {
      try {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { windowsHide: true, stdio: 'pipe' });
      } catch {
        proc.kill('SIGTERM');
      }
    } else {
      proc.kill('SIGTERM');
    }

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, 10000);

    proc.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
