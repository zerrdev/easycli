import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_FILENAME = '.cligr.yml';
const TEMPLATE = `# Cligr Configuration

groups:
  web:
    tool: docker
    restart: false
    items:
      - "nginx,8080"      # $1=nginx (name), $2=8080 (port)
      - "nginx,3000"

  simple:
    tool: node
    items:
      - "server"          # $1=server (name only)

tools:
  docker:
    cmd: "docker run -p $2:$2 nginx"   # $1=name, $2=port
  node:
    cmd: "node $1.js"                   # $1=file name

# Syntax:
# - Items are comma-separated: "name,arg2,arg3"
# - $1 = name (first value)
# - $2, $3... = additional arguments
# - If no tool specified, executes directly
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
  fs.writeFileSync(filePath, TEMPLATE, 'utf-8');
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
