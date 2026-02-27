const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Resolve full path to `claude` binary at startup.
// node-pty's posix_spawnp may fail if the binary isn't on the
// inherited PATH (common when Node is launched outside a login shell).
let CLAUDE_BIN = null;
try {
  // Spawn a login shell so ~/.zshrc / ~/.bashrc PATH entries are loaded
  const shell = process.env.SHELL || '/bin/zsh';
  CLAUDE_BIN = execSync(`${shell} -lc 'which claude'`, { encoding: 'utf8' }).trim();
} catch {
  // Login shell lookup failed — try common install locations
  const candidates = [
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { CLAUDE_BIN = c; break; }
  }
}
if (!CLAUDE_BIN) {
  console.error('ERROR: Could not find `claude` CLI anywhere.');
  console.error('Make sure Claude Code is installed: npm install -g @anthropic-ai/claude-code');
  console.error('Or set CLAUDE_BIN env var: CLAUDE_BIN=/path/to/claude node server.js');
  process.exit(1);
}
// Allow manual override via env var
CLAUDE_BIN = process.env.CLAUDE_BIN || CLAUDE_BIN;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3456;
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// --- Session persistence ---

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load sessions:', e.message);
  }
  return [];
}

function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

let sessions = loadSessions(); // persisted metadata
const activePtys = new Map();  // id -> { pty, status, lastActivity, wsClients: Set }

// --- Express routes ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/sessions', (req, res) => {
  const enriched = sessions.map(s => ({
    ...s,
    status: activePtys.has(s.id) ? activePtys.get(s.id).status : 'disconnected',
  }));
  res.json(enriched);
});

app.post('/api/sessions', (req, res) => {
  const { name, cwd, args } = req.body;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const session = {
    id,
    name: name || `Session ${sessions.length + 1}`,
    cwd: cwd || os.homedir(),
    args: args || [],
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  sessions.push(session);
  saveSessions(sessions);
  res.json(session);
});

app.patch('/api/sessions/:id', (req, res) => {
  const session = sessions.find(s => s.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Not found' });
  if (req.body.name !== undefined) session.name = req.body.name;
  saveSessions(sessions);
  res.json(session);
});

app.delete('/api/sessions/:id', (req, res) => {
  const id = req.params.id;
  // Kill pty if active
  if (activePtys.has(id)) {
    const entry = activePtys.get(id);
    try { entry.pty.kill(); } catch (e) {}
    activePtys.delete(id);
  }
  sessions = sessions.filter(s => s.id !== id);
  saveSessions(sessions);
  res.json({ ok: true });
});

app.get('/api/recent-dirs', (req, res) => {
  // Return unique cwds from sessions + home dir
  const dirs = [...new Set([os.homedir(), ...sessions.map(s => s.cwd)])];
  res.json(dirs);
});

app.get('/api/browse', (req, res) => {
  const dir = req.query.path || os.homedir();
  const showFiles = req.query.files === '1';
  const resolved = dir.replace(/^~/, os.homedir());
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return res.status(400).json({ error: 'Not a valid directory' });
    }
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const folders = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => {
        try {
          const st = fs.statSync(path.join(resolved, e.name));
          return { name: e.name, mtime: st.mtimeMs };
        } catch { return { name: e.name, mtime: 0 }; }
      })
      .sort((a, b) => b.mtime - a.mtime);
    const files = showFiles
      ? entries
          .filter(e => e.isFile() && !e.name.startsWith('.'))
          .map(e => {
            try {
              const st = fs.statSync(path.join(resolved, e.name));
              return { name: e.name, mtime: st.mtimeMs };
            } catch { return { name: e.name, mtime: 0 }; }
          })
          .sort((a, b) => b.mtime - a.mtime)
      : [];
    const parent = path.dirname(resolved);
    res.json({ current: resolved, parent: parent !== resolved ? parent : null, folders, files });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --- WebSocket handling ---

wss.on('connection', (ws) => {
  let boundSessionId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'attach': {
        const id = msg.sessionId;
        boundSessionId = id;
        const session = sessions.find(s => s.id === id);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
          return;
        }

        if (activePtys.has(id)) {
          // Re-attach to existing pty
          const entry = activePtys.get(id);
          entry.wsClients.add(ws);
          ws.send(JSON.stringify({ type: 'attached', sessionId: id, status: entry.status }));
          // Send buffered output
          if (entry.scrollback) {
            ws.send(JSON.stringify({ type: 'output', data: entry.scrollback }));
          }
        } else {
          // Spawn new pty
          let resolvedCwd = session.cwd || os.homedir();
          // Validate cwd exists, fallback to home
          if (!fs.existsSync(resolvedCwd)) {
            console.warn(`cwd "${resolvedCwd}" does not exist, falling back to home`);
            resolvedCwd = os.homedir();
          }
          const env = { ...process.env };
          // Unset CLAUDECODE to avoid nesting issues
          delete env.CLAUDECODE;
          delete env.CLAUDE_CODE;

          const cliArgs = [...(session.args || [])];

          let ptyProcess;
          try {
            ptyProcess = pty.spawn(CLAUDE_BIN, cliArgs, {
              name: 'xterm-256color',
              cols: msg.cols || 120,
              rows: msg.rows || 40,
              cwd: resolvedCwd,
              env,
            });
          } catch (err) {
            ws.send(JSON.stringify({ type: 'output', data: `\r\nError starting claude: ${err.message}\r\n` }));
            ws.send(JSON.stringify({ type: 'status', sessionId: id, status: 'exited' }));
            return;
          }

          const entry = {
            pty: ptyProcess,
            status: 'active',
            lastActivity: Date.now(),
            wsClients: new Set([ws]),
            scrollback: '',
          };
          activePtys.set(id, entry);

          // Status detection via output activity
          let activityTimer = null;
          const IDLE_TIMEOUT = 3000; // 3s no output -> idle

          ptyProcess.onData((data) => {
            entry.lastActivity = Date.now();
            entry.status = 'active';
            // Keep last 100KB of scrollback for re-attach
            entry.scrollback += data;
            if (entry.scrollback.length > 100000) {
              entry.scrollback = entry.scrollback.slice(-80000);
            }

            // Broadcast to all attached clients
            const outMsg = JSON.stringify({ type: 'output', data });
            entry.wsClients.forEach(c => {
              if (c.readyState === 1) c.send(outMsg);
            });

            // Reset idle timer
            clearTimeout(activityTimer);
            activityTimer = setTimeout(() => {
              // If the pty process is alive and stopped outputting, it's waiting for user input
              entry.status = 'waiting';
              broadcastStatus(id, entry);
            }, IDLE_TIMEOUT);

            // Broadcast active status
            broadcastStatus(id, entry);

            // Update session lastActiveAt
            session.lastActiveAt = new Date().toISOString();
          });

          ptyProcess.onExit(({ exitCode }) => {
            entry.status = 'exited';
            broadcastStatus(id, entry);
            clearTimeout(activityTimer);
            // Don't remove from activePtys immediately - let user see the exit state
          });

          ws.send(JSON.stringify({ type: 'attached', sessionId: id, status: 'active' }));
        }
        break;
      }

      case 'input': {
        if (boundSessionId && activePtys.has(boundSessionId)) {
          activePtys.get(boundSessionId).pty.write(msg.data);
        }
        break;
      }

      case 'resize': {
        if (boundSessionId && activePtys.has(boundSessionId)) {
          const entry = activePtys.get(boundSessionId);
          try { entry.pty.resize(msg.cols, msg.rows); } catch (e) {}
        }
        break;
      }

      case 'detach': {
        if (boundSessionId && activePtys.has(boundSessionId)) {
          activePtys.get(boundSessionId).wsClients.delete(ws);
        }
        boundSessionId = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    if (boundSessionId && activePtys.has(boundSessionId)) {
      activePtys.get(boundSessionId).wsClients.delete(ws);
    }
  });
});

function broadcastStatus(sessionId, entry) {
  const msg = JSON.stringify({ type: 'status', sessionId, status: entry.status });
  entry.wsClients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

// --- Periodic save ---
setInterval(() => saveSessions(sessions), 30000);

// --- Start ---
server.listen(PORT, () => {
  console.log(`Claude Hub running at http://localhost:${PORT}`);
  console.log(`Using claude binary: ${CLAUDE_BIN}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process or use a different port.`);
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down Claude Hub...');
  saveSessions(sessions);
  // Kill all active ptys
  activePtys.forEach((entry, id) => {
    try { entry.pty.kill(); } catch (e) {}
  });
  process.exit(0);
});
