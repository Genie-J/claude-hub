# Claude Hub

Browser-based UI for managing multiple Claude Code CLI sessions side by side.

## Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## Setup

```bash
git clone https://github.com/janetzhong/claude-hub.git
cd claude-hub
pnpm install    # or npm install
pnpm start      # opens at http://localhost:3456
```

## What it does

- Spawn multiple Claude Code sessions in browser tabs
- Each session runs a real `claude` CLI process via PTY
- Sessions persist across page refreshes (reconnect to running processes)
- Pick working directory per session
