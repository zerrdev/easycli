import http from 'http';
import { ConfigLoader } from '../config/loader.js';
import { ProcessManager } from '../process/manager.js';
import { TemplateExpander } from '../process/template.js';

export async function serveCommand(portArg?: string): Promise<number> {
  const port = portArg ? parseInt(portArg, 10) : 7373;
  const loader = new ConfigLoader();
  const manager = new ProcessManager();

  // Clean up any stale PID files on startup
  await manager.cleanupStalePids();

  const clients: http.ServerResponse[] = [];

  const sendEvent = (event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (let i = clients.length - 1; i >= 0; i--) {
      const client = clients[i];
      try {
        client.write(payload);
      } catch {
        clients.splice(i, 1);
        try { client.end(); } catch { /* ignore */ }
      }
    }
  };

  manager.on('group-started', (groupName) => {
    sendEvent('status', { type: 'group-started', groupName });
  });

  manager.on('group-stopped', (groupName) => {
    sendEvent('status', { type: 'group-stopped', groupName });
  });

  manager.on('item-restarted', (groupName, itemName) => {
    sendEvent('status', { type: 'item-restarted', groupName, itemName });
  });

  manager.on('process-log', (groupName, itemName, line, isError) => {
    sendEvent('log', { group: groupName, item: itemName, line, isError });
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.writeHead(200);
      res.end(serveHtml());
      return;
    }

    if (url.pathname === '/api/groups') {
      try {
        const config = loader.load();
        const groups = Object.entries(config.groups).map(([name, group]) => ({
          name,
          tool: group.tool,
          restart: group.restart,
          items: Object.entries(group.items).map(([itemName, value]) => ({
            name: itemName,
            value,
            enabled: !(group.disabledItems || []).includes(itemName),
          })),
          running: manager.isGroupRunning(name),
        }));
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(200);
        res.end(JSON.stringify({ groups }));
      } catch (err) {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    if (url.pathname === '/api/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);
      res.write(':ok\n\n');
      clients.push(res);
      req.on('close', () => {
        const index = clients.indexOf(res);
        if (index !== -1) clients.splice(index, 1);
      });
      return;
    }

    const toggleMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/toggle$/);
    if (toggleMatch && req.method === 'POST') {
      const groupName = decodeURIComponent(toggleMatch[1]);
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const { enabled } = parsed;
        try {
          if (enabled) {
            const { config, items, tool, toolTemplate, params } = loader.getGroup(groupName);
            const processItems = items.map((item, index) =>
              TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
            );
            manager.spawnGroup(groupName, processItems, config.restart);
          } else {
            await manager.killGroup(groupName);
          }
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    const itemToggleMatch = url.pathname.match(/^\/api\/groups\/([^/]+)\/items\/([^/]+)\/toggle$/);
    if (itemToggleMatch && req.method === 'POST') {
      const groupName = decodeURIComponent(itemToggleMatch[1]);
      const itemName = decodeURIComponent(itemToggleMatch[2]);
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', async () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const { enabled } = parsed;
        try {
          loader.toggleItem(groupName, itemName, enabled);

          if (manager.isGroupRunning(groupName)) {
            const { config, items, tool, toolTemplate, params } = loader.getGroup(groupName);
            const processItems = items.map((item, index) =>
              TemplateExpander.parseItem(tool, toolTemplate, item, index, params)
            );
            await manager.restartGroup(groupName, processItems, config.restart);
          }

          res.setHeader('Content-Type', 'application/json');
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.setHeader('Content-Type', 'application/json');
          res.writeHead(500);
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(2);
    }
  });

  let resolveCommand: (value: number) => void;
  const commandPromise = new Promise<number>((resolve) => {
    resolveCommand = resolve;
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    server.close();
    await manager.killAll();
    resolveCommand(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, () => {
    console.log(`cligr serve running at http://localhost:${port}`);
  });

  return commandPromise;
}

function serveHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>cligr serve</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body { font-family: system-ui, sans-serif; display: flex; flex-direction: column; }
    h1 { font-size: 1.25rem; margin: 0; padding: 0.75rem 1rem; border-bottom: 1px solid #ccc; background: #f8f8f8; }
    .container { display: flex; flex: 1; overflow: hidden; }
    .sidebar { width: 320px; min-width: 260px; border-right: 1px solid #ccc; padding: 1rem; overflow-y: auto; background: #fafafa; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .main h2 { font-size: 1rem; margin: 0; padding: 0.5rem 1rem; border-bottom: 1px solid #ccc; background: #f0f0f0; }
    .group { border: 1px solid #ccc; border-radius: 6px; padding: 0.75rem; margin: 0 0 0.75rem 0; background: #fff; }
    .group-header { display: flex; align-items: center; gap: 0.5rem; font-weight: bold; font-size: 1rem; }
    .items { margin: 0.5rem 0 0 1.25rem; }
    .item { display: flex; align-items: center; gap: 0.4rem; margin: 0.2rem 0; font-size: 0.9rem; }
    .logs { flex: 1; background: #111; color: #0f0; font-family: monospace; font-size: 0.85rem; overflow-y: auto; padding: 0.75rem; white-space: pre-wrap; }
    .error { color: #f55; }
  </style>
</head>
<body>
  <h1>cligr serve</h1>
  <div class="container">
    <div class="sidebar" id="groups"></div>
    <div class="main">
      <h2>Console</h2>
      <div class="logs" id="logs"></div>
    </div>
  </div>

  <script>
    const groupsEl = document.getElementById('groups');
    const logsEl = document.getElementById('logs');
    let autoScroll = true;

    async function fetchGroups() {
      const res = await fetch('/api/groups');
      const data = await res.json();
      renderGroups(data.groups);
    }

    function renderGroups(groups) {
      groupsEl.innerHTML = '';
      for (const g of groups) {
        const div = document.createElement('div');
        div.className = 'group';

        const header = document.createElement('div');
        header.className = 'group-header';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = g.running;
        checkbox.onchange = async () => {
          await fetch(\`/api/groups/\${encodeURIComponent(g.name)}/toggle\`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: checkbox.checked })
          });
        };
        header.appendChild(checkbox);
        header.appendChild(document.createTextNode(g.name + ' (' + g.tool + ')' + (g.running ? ' - running' : '')));
        div.appendChild(header);

        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'items';
        for (const item of g.items) {
          const itemDiv = document.createElement('div');
          itemDiv.className = 'item';
          const itemCb = document.createElement('input');
          itemCb.type = 'checkbox';
          itemCb.checked = item.enabled;
          itemCb.onchange = async () => {
            await fetch(\`/api/groups/\${encodeURIComponent(g.name)}/items/\${encodeURIComponent(item.name)}/toggle\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: itemCb.checked })
            });
          };
          itemDiv.appendChild(itemCb);
          itemDiv.appendChild(document.createTextNode(item.name + ': ' + item.value));
          itemsDiv.appendChild(itemDiv);
        }
        div.appendChild(itemsDiv);
        groupsEl.appendChild(div);
      }
    }

    logsEl.addEventListener('scroll', () => {
      autoScroll = logsEl.scrollTop + logsEl.clientHeight >= logsEl.scrollHeight - 10;
    });

    function appendLog(line, isError) {
      const span = document.createElement('div');
      span.textContent = line;
      if (isError) span.className = 'error';
      logsEl.appendChild(span);
      if (autoScroll) logsEl.scrollTop = logsEl.scrollHeight;
    }

    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('status', (e) => {
      fetchGroups();
    });
    evtSource.addEventListener('log', (e) => {
      const data = JSON.parse(e.data);
      appendLog(\`[\${data.group}/\${data.item}] \${data.line}\`, data.isError);
    });
    evtSource.onerror = () => {
      appendLog('[SSE connection error]', true);
    };

    fetchGroups();
  </script>
</body>
</html>`;
}
