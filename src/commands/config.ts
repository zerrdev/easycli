import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_FILENAME = '.cligr.yml';
export const CONFIG_TEMPLATE = `# Cligr Configuration

groups:
  web:
    tool: docker
    restart: no
    items:
      nginx8080: "nginx,8080"    # $1=nginx, $2=8080
      nginx3000: "nginx,3000"

  simple:
    tool: node
    items:
      server: "server"           # $1=server

  # A one-shot group: runs, prints its output, and exits.
  nav-stg:
    tool: kubectx
    mode: once
    items:
      ctx: "staging"

tools:
  docker:
    cmd: "docker run -p $2:$2 nginx"    # $1=name, $2=port
  node:
    cmd: "node $1.js"                    # $1=file name
  kubectx:
    cmd: "kubectl config use-context $1"

# Syntax:
# - Items are named: itemName: "value1,value2"
# - $1 = first value, $2, $3... = the rest
# - If no tool is specified, the item value runs directly
# - restart: yes | no | unless-stopped
# - mode: once runs the group to completion and exits instead of supervising it
`;

function detectEditor(): string {
  const platform = process.platform;

  // Try VS Code first
  const whichCmd = platform === 'win32' ? 'where' : 'which';
  const codeCheck = spawnSync(whichCmd, ['code'], { stdio: 'ignore' });
  if (codeCheck.status === 0) {
    return 'code';
  }

  // Try EDITOR environment variable
  if (process.env.EDITOR) {
    return process.env.EDITOR;
  }

  // Platform defaults
  if (platform === 'win32') {
    return 'notepad.exe';
  }
  return 'vim';
}

function spawnEditor(filePath: string, editorCmd: string): void {
  // Check if editor exists before spawning
  const platform = process.platform;
  const whichCmd = platform === 'win32' ? 'where' : 'which';
  const editorCheck = spawnSync(whichCmd, [editorCmd], { stdio: 'ignore' });

  if (editorCheck.status !== 0 && editorCmd !== process.env.EDITOR) {
    throw new Error(
      `Editor '${editorCmd}' not found.\n` +
      `Install VS Code or set EDITOR environment variable.\n\n` +
      `Example:\n` +
      `  export EDITOR=vim\n` +
      `  cligr config`
    );
  }

  // Spawn detached so terminal is not blocked
  const child = spawn(editorCmd, [filePath], {
    detached: true,
    stdio: 'ignore',
    shell: platform === 'win32',
  });

  child.unref();
}

function createTemplate(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, CONFIG_TEMPLATE, 'utf-8');
}

export async function configCommand(): Promise<number> {
  try {
    // Determine config path (same logic as ConfigLoader)
    const homeDirConfig = path.join(os.homedir(), CONFIG_FILENAME);
    const currentDirConfig = path.resolve(CONFIG_FILENAME);

    let configPath: string;
    if (fs.existsSync(homeDirConfig)) {
      configPath = homeDirConfig;
    } else if (fs.existsSync(currentDirConfig)) {
      configPath = currentDirConfig;
    } else {
      configPath = homeDirConfig;
    }

    // Create template if doesn't exist
    if (!fs.existsSync(configPath)) {
      createTemplate(configPath);
    }

    // Detect and open editor
    const editor = detectEditor();
    spawnEditor(configPath, editor);

    console.log(`Opening ${configPath} in ${editor}...`);
    return 0;
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
}
