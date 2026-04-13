import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';

let serverProcess: import('child_process').ChildProcess | null = null;

describe('serve command integration tests', () => {
  let testConfigDir: string;
  let testConfigPath: string;
  let originalHomeDir: string;

  before(async () => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cligr-serve-test-'));
    testConfigPath = path.join(testConfigDir, '.cligr.yml');
    originalHomeDir = os.homedir();
    mock.method(os, 'homedir', () => testConfigDir);

    // Build dist/index.js
    const { spawnSync } = await import('child_process');
    const result = spawnSync('npm', ['run', 'build'], { cwd: process.cwd(), stdio: 'pipe', shell: true });
    if (result.status !== 0) {
      throw new Error('Build failed: ' + result.stderr?.toString());
    }
  });

  after(async () => {
    mock.method(os, 'homedir', () => originalHomeDir);
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    await stopServer();
  });

  afterEach(async () => {
    await stopServer();
  });

  async function stopServer() {
    const proc = serverProcess;
    if (!proc) return;
    serverProcess = null;
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      proc.kill();
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
        resolve();
      }, 500);
      proc.once('exit', () => clearTimeout(timeout));
    });
  }

  async function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, () => {
        const addr = srv.address() as net.AddressInfo;
        srv.close(() => resolve(addr.port));
      });
      srv.on('error', reject);
    });
  }

  function writeConfig() {
    const configContent = `
tools:
  node:
    cmd: node -e "console.log('$1')"
groups:
  web:
    tool: node
    restart: no
    disabledItems:
      - worker
    items:
      server: server
      worker: worker
`;
    fs.writeFileSync(testConfigPath, configContent);
  }

  async function startServer(port: number) {
    const { spawn } = await import('child_process');
    const env = { ...process.env, USERPROFILE: testConfigDir, HOME: testConfigDir };
    serverProcess = spawn('node', ['dist/index.js', 'serve', String(port)], {
      cwd: process.cwd(),
      stdio: 'pipe',
      env
    });

    // Wait for server to be ready
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const onData = (data: Buffer) => {
        output += data.toString();
        if (output.includes('cligr serve running at')) {
          cleanup();
          resolve();
        }
      };
      const onError = (data: Buffer) => {
        output += data.toString();
      };
      serverProcess!.stdout!.on('data', onData);
      serverProcess!.stderr!.on('data', onError);

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Server startup timeout. Output: ' + output));
      }, 5000);

      const cleanup = () => {
        clearTimeout(timeout);
        serverProcess!.stdout!.off('data', onData);
        serverProcess!.stderr!.off('data', onError);
      };
    });
  }

  async function httpGet(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on('error', reject);
      req.setTimeout(2000, () => reject(new Error('HTTP timeout')));
    });
  }

  async function httpPost(url: string, body: object): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => responseBody += chunk);
        res.on('end', () => resolve({ status: res.statusCode || 0, body: responseBody }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  it('should serve the HTML UI', { timeout: 15000 }, async () => {
    writeConfig();
    const port = await getFreePort();
    await startServer(port);

    const res = await httpGet(`http://localhost:${port}/`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.includes('cligr serve'));
  });

  it('should return groups via API', { timeout: 15000 }, async () => {
    writeConfig();
    const port = await getFreePort();
    await startServer(port);

    const res = await httpGet(`http://localhost:${port}/api/groups`);
    assert.strictEqual(res.status, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.groups));
    assert.strictEqual(data.groups.length, 1);
    assert.strictEqual(data.groups[0].name, 'web');
    assert.strictEqual(data.groups[0].running, false);
    assert.strictEqual(data.groups[0].items.length, 2);
    const serverItem = data.groups[0].items.find((i: any) => i.name === 'server');
    const workerItem = data.groups[0].items.find((i: any) => i.name === 'worker');
    assert.strictEqual(serverItem.enabled, true);
    assert.strictEqual(workerItem.enabled, false);
  });

  it('should toggle group via API', { timeout: 15000 }, async () => {
    writeConfig();
    const port = await getFreePort();
    await startServer(port);

    const postRes = await httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: true });
    assert.strictEqual(postRes.status, 200);

    await new Promise(r => setTimeout(r, 300));

    const getRes = await httpGet(`http://localhost:${port}/api/groups`);
    const data = JSON.parse(getRes.body);
    const web = data.groups.find((g: any) => g.name === 'web');
    assert.strictEqual(web.running, true);

    await httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: false });
  });

  it('should toggle item via API', { timeout: 15000 }, async () => {
    writeConfig();
    const port = await getFreePort();
    await startServer(port);

    const postRes = await httpPost(`http://localhost:${port}/api/groups/web/items/worker/toggle`, { enabled: true });
    assert.strictEqual(postRes.status, 200);

    const getRes = await httpGet(`http://localhost:${port}/api/groups`);
    const data = JSON.parse(getRes.body);
    const web = data.groups.find((g: any) => g.name === 'web');
    const worker = web.items.find((i: any) => i.name === 'worker');
    assert.strictEqual(worker.enabled, true);
  });

  it('should stream SSE events', { timeout: 15000 }, async () => {
    writeConfig();
    const port = await getFreePort();
    await startServer(port);

    return new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/api/events`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes('event: status')) {
            req.destroy();
            resolve();
          }
        });
      });
      req.on('error', reject);

      setTimeout(() => {
        httpPost(`http://localhost:${port}/api/groups/web/toggle`, { enabled: true }).catch(() => {});
      }, 200);

      setTimeout(() => {
        req.destroy();
        reject(new Error('SSE timeout'));
      }, 3000);
    });
  });
});
