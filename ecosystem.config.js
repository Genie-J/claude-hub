module.exports = {
  apps: [{
    name: 'claude-hub',
    script: 'server.js',
    cwd: __dirname,
    max_memory_restart: '500M',
    restart_delay: 1000,
    max_restarts: 20,
    env: { NODE_ENV: 'production' }
  }]
};
