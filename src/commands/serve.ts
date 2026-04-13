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
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        // Client disconnected
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

  server.listen(port, () => {
    console.log(`cligr serve running at http://localhost:${port}`);
  });

  // Keep process alive
  return new Promise(() => {});
}

function serveHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>cligr serve</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; }
    .group { border: 1px solid #ccc; border-radius: 6px; padding: 1rem; margin: 1rem 0; }
    .group-header { display: flex; align-items: center; gap: 0.5rem; font-weight: bold; font-size: 1.1rem; }
    .items { margin: 0.5rem 0 0 1.5rem; }
    .item { display: flex; align-items: center; gap: 0.4rem; margin: 0.25rem 0; }
    .logs { background: #111; color: #0f0; font-family: monospace; font-size: 0.85rem; height: 300px; overflow-y: auto; padding: 0.75rem; border-radius: 4px; white-space: pre-wrap; }
    .error { color: #f55; }
  </style>
</head>
<body>
  <h1>cligr serve</h1>
  <div id="groups"></div>
  <h2>Logs</h2>
  <div class="logs" id="logs"></div>

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
