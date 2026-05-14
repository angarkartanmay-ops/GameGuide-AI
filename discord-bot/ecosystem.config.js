// PM2 process manager config — for self-hosted 24/7 (VPS, home server, Pi).
//
// Install once:
//   npm i -g pm2
//
// Start the bot:
//   pm2 start ecosystem.config.js
//   pm2 save
//
// Auto-start on system boot:
//   pm2 startup       (then run the command it prints)
//
// Monitor / logs:
//   pm2 status
//   pm2 logs gameguide-bot
//   pm2 restart gameguide-bot

module.exports = {
  apps: [{
    name: 'gameguide-bot',
    script: 'index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '400M',
    restart_delay: 4000,
    exp_backoff_restart_delay: 100,
    max_restarts: 50,
    min_uptime: '30s',
    kill_timeout: 8000,
    env: {
      NODE_ENV: 'production',
    },
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
};
