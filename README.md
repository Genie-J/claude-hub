# Claude Hub

A browser-based command center for running multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions in parallel. Think of it as a tabbed terminal — but every tab is a Claude.

## Features

**Multi-Session Management**
- Run multiple Claude Code sessions side by side in browser tabs
- Each session spawns a real `claude` CLI process via PTY — full terminal fidelity
- Name, rename, search, and organize sessions from the sidebar

**Session Persistence**
- Sessions survive page refreshes — reconnect to running processes instantly
- 100KB scrollback buffer per session, so you never lose context
- Auto-saves session metadata every 30 seconds

**Flexible Configuration**
- Pick working directory per session with a built-in folder browser
- Choose model (Opus / Sonnet) and permission mode per session
- Resume previous conversations with one click (`--resume`)

**Developer-Friendly UX**
- Keyboard shortcuts: `Cmd+T` new, `Cmd+W` close, `Cmd+1-9` switch, `Cmd+Shift+[]` prev/next
- Drag & drop files from Finder into the terminal
- Right-click context menu for quick actions
- Desktop notifications when a session needs your attention
- Installable as a standalone Chrome app (PWA)

## Quick Start

**Prerequisites:** Node.js >= 18 and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed & authenticated.

```bash
git clone https://github.com/Genie-J/claude-hub.git
cd claude-hub
pnpm install    # or npm install
pnpm start      # http://localhost:3456
```

## Tech Stack

Express + WebSocket + [node-pty](https://github.com/nickvdp/node-pty) on the backend. React + [xterm.js](https://xtermjs.org/) on the frontend. Zero build step — just `node server.js`.

## License

ISC
