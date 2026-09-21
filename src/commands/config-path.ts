import fs from 'fs';
import { resolveConfigPath } from '../config/loader.js';

/**
 * Prints nothing but the path, so it stays usable in a shell substitution:
 * `cat $(cligr config-path)`. Any note about a missing file goes to stderr.
 */
export function configPathCommand(): number {
  const configPath = resolveConfigPath();

  console.log(configPath);

  if (!fs.existsSync(configPath)) {
    console.error('No config file yet - run "cligr config" to create one here.');
  }

  return 0;
}
