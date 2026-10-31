#!/usr/bin/env node
/**
 * BeamDrop — Standalone Deployment & Management Tool
 * Usage:
 *   node deploy.js [command] [options]
 *
 * Commands:
 *   standalone   Start BeamDrop as a standalone background daemon (no Docker required)
 *   start        Start BeamDrop in foreground mode
 *   docker       Build and deploy using Docker Compose
 *   systemd      Generate / install Linux systemd service for standalone VPS deployment
 *   status       Check health and status of BeamDrop server
 *   stop         Stop running standalone daemon or Docker container
 *   init         Create or update .env configuration file
 *
 * Options:
 *   --port <number>       Set server port (default: 3055)
 *   --url <string>        Set public domain URL (e.g. https://qr.example.com)
 *   --max-size <number>   Set max file upload size in MB (default: 150)
 *   --ttl <number>        Set default expiration TTL in minutes (default: 60)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn, execSync } = require('child_process');

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example');
const PID_FILE = path.join(ROOT_DIR, '.beamdrop.pid');
const LOG_FILE = path.join(ROOT_DIR, 'beamdrop.log');

function getLanIp() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {}
  return 'localhost';
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let command = 'help';
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-')) {
      if (command === 'help') command = arg.toLowerCase();
    } else if (arg === '--port' || arg === '-p') {
      flags.PORT = args[++i];
    } else if (arg === '--url' || arg === '-u') {
      flags.PUBLIC_URL = args[++i];
    } else if (arg === '--max-size' || arg === '-m') {
      flags.MAX_FILE_SIZE_MB = args[++i];
    } else if (arg === '--ttl' || arg === '-t') {
      flags.FILE_TTL_MINUTES = args[++i];
    } else if (arg === '--standalone' || arg === '-s') {
      command = 'standalone';
    } else if (arg === '--docker' || arg === '-d') {
      command = 'docker';
    } else if (arg === '--systemd') {
      command = 'systemd';
    } else if (arg === '--status') {
      command = 'status';
    } else if (arg === '--stop') {
      command = 'stop';
    } else if (arg === '--help' || arg === '-h') {
      command = 'help';
    }
  }

  return { command, flags };
}

function readEnv() {
  const env = {
    PORT: '3055',
    MAX_FILE_SIZE_MB: '150',
    FILE_TTL_MINUTES: '60',
    PUBLIC_URL: ''
  };

  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        env[k] = v;
      }
    }
  }
  return env;
}

function writeEnv(overrides = {}) {
  const current = readEnv();
  const merged = { ...current, ...overrides };

  const content = [
    '# BeamDrop Standalone Configuration',
    `PORT=${merged.PORT || 3055}`,
    `MAX_FILE_SIZE_MB=${merged.MAX_FILE_SIZE_MB || 150}`,
    `FILE_TTL_MINUTES=${merged.FILE_TTL_MINUTES || 60}`,
    `PUBLIC_URL=${merged.PUBLIC_URL || ''}`,
    ''
  ].join('\n');

  fs.writeFileSync(ENV_PATH, content, 'utf8');
  return merged;
}

function ensureDependencies() {
  const nodeModulesPath = path.join(ROOT_DIR, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('📦 Installing production dependencies...');
    execSync('npm install --omit=dev', { cwd: ROOT_DIR, stdio: 'inherit' });
  }
}

function ensureEnv(flags) {
  if (!fs.existsSync(ENV_PATH)) {
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
      fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
    }
  }
  if (Object.keys(flags).length > 0 || !fs.existsSync(ENV_PATH)) {
    return writeEnv(flags);
  }
  return readEnv();
}

function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 2500 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve({ healthy: true, data: JSON.parse(body) });
            return;
          } catch (e) {}
        }
        resolve({ healthy: false });
      });
    });
    req.on('error', () => resolve({ healthy: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ healthy: false });
    });
  });
}

async function waitForServer(port, attempts = 12) {
  for (let i = 0; i < attempts; i++) {
    const status = await checkHealth(port);
    if (status.healthy) return status.data;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

async function startStandaloneDaemon(flags) {
  ensureDependencies();
  const env = ensureEnv(flags);
  const port = parseInt(env.PORT, 10) || 3055;

  // Check if already running
  if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (existingPid && isPidRunning(existingPid)) {
      console.log(`ℹ️  BeamDrop is already running in standalone mode (PID: ${existingPid}).`);
      await printStatus(port, env);
      return;
    }
    fs.unlinkSync(PID_FILE);
  }

  console.log('🚀 Launching BeamDrop standalone background daemon...');
  const outFd = fs.openSync(LOG_FILE, 'a');
  const errFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env, ...env }
  });

  fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
  child.unref();

  const health = await waitForServer(port);
  const lanIp = getLanIp();

  console.log('====================================================');
  if (health) {
    console.log('✅ BeamDrop Standalone Server is ONLINE!');
  } else {
    console.log('⚠️  BeamDrop process started, check beamdrop.log if unreachable.');
  }
  console.log(`📌 Process ID:  ${child.pid} (saved to .beamdrop.pid)`);
  console.log(`📄 Log File:    ${LOG_FILE}`);
  console.log(`🌐 Local URL:   http://localhost:${port}`);
  if (lanIp && lanIp !== 'localhost') {
    console.log(`📱 Network URL: http://${lanIp}:${port}`);
  }
  if (env.PUBLIC_URL) {
    console.log(`🌍 Public URL:  ${env.PUBLIC_URL}`);
  }
  console.log('====================================================');
  console.log('💡 Manage commands: npm run status | npm run stop');
}

function startForeground(flags) {
  ensureDependencies();
  const env = ensureEnv(flags);
  console.log('🚀 Starting BeamDrop in foreground...');
  const child = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  child.on('exit', (code) => process.exit(code || 0));
}

async function deployDocker(flags) {
  const env = ensureEnv(flags);
  const port = parseInt(env.PORT, 10) || 3055;
  console.log('🐳 Building and starting BeamDrop via Docker Compose...');
  try {
    execSync('docker compose up -d --build', { cwd: ROOT_DIR, stdio: 'inherit' });
    const health = await waitForServer(port);
    const lanIp = getLanIp();
    console.log('====================================================');
    console.log(health ? '✅ BeamDrop Docker Container is ONLINE!' : '✅ Docker container launched!');
    console.log(`🌐 Local URL:   http://localhost:${port}`);
    if (lanIp && lanIp !== 'localhost') {
      console.log(`📱 Network URL: http://${lanIp}:${port}`);
    }
    if (env.PUBLIC_URL) {
      console.log(`🌍 Public URL:  ${env.PUBLIC_URL}`);
    }
    console.log('====================================================');
  } catch (err) {
    console.error('❌ Docker deployment failed. Make sure Docker & Docker Compose are installed and running.');
    process.exit(1);
  }
}

function generateSystemdService(flags) {
  ensureDependencies();
  const env = ensureEnv(flags);
  const nodePath = process.execPath;
  const user = os.userInfo().username || 'root';

  const unitContent = `[Unit]
Description=BeamDrop Ephemeral QR File Transfer & Link Shortener
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${ROOT_DIR}
EnvironmentFile=${ENV_PATH}
ExecStart=${nodePath} ${path.join(ROOT_DIR, 'server.js')}
Restart=on-failure
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=beamdrop

[Install]
WantedBy=multi-user.target
`;

  const localUnitFile = path.join(ROOT_DIR, 'beamdrop.service');
  fs.writeFileSync(localUnitFile, unitContent, 'utf8');
  console.log(`✅ Generated systemd service file: ${localUnitFile}`);

  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    try {
      const targetUnit = '/etc/systemd/system/beamdrop.service';
      fs.copyFileSync(localUnitFile, targetUnit);
      execSync('systemctl daemon-reload', { stdio: 'inherit' });
      execSync('systemctl enable beamdrop.service', { stdio: 'inherit' });
      execSync('systemctl restart beamdrop.service', { stdio: 'inherit' });
      console.log('🚀 Systemd service installed, enabled, and started!');
      return;
    } catch (e) {
      console.warn('⚠️  Could not auto-enable systemd service:', e.message);
    }
  }

  console.log('\n📋 To install and start as a Linux system service, run:');
  console.log(`   sudo cp "${localUnitFile}" /etc/systemd/system/beamdrop.service`);
  console.log('   sudo systemctl daemon-reload');
  console.log('   sudo systemctl enable --now beamdrop');
}

async function printStatus(port, env) {
  const status = await checkHealth(port);
  let pidInfo = 'Not running (no PID file)';
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid && isPidRunning(pid)) {
      pidInfo = `Running (PID: ${pid})`;
    } else {
      pidInfo = 'Stopped (stale PID file)';
    }
  }

  console.log('====================================================');
  console.log('📊 BeamDrop Server Status');
  console.log('====================================================');
  console.log(`Standalone Daemon: ${pidInfo}`);
  console.log(`Port:              ${port}`);
  console.log(`Public URL:        ${env.PUBLIC_URL || '(Auto-detect / LAN IP)'}`);
  if (status.healthy && status.data) {
    console.log(`Health Check:      🟢 ONLINE (Uptime: ${status.data.uptime}s)`);
    console.log(`Active Transfers:  ${status.data.activeFiles || 0} files`);
    console.log(`Active ShortURLs:  ${status.data.activeLinks || 0} links`);
  } else {
    console.log(`Health Check:      🔴 OFFLINE on port ${port}`);
  }
  console.log('====================================================');
}

function stopServer() {
  let stopped = false;

  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (pid && isPidRunning(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`🛑 Stopped standalone BeamDrop daemon (PID: ${pid}).`);
        stopped = true;
      } catch (e) {
        console.error(`Failed to stop PID ${pid}:`, e.message);
      }
    }
    try {
      fs.unlinkSync(PID_FILE);
    } catch (e) {}
  }

  if (!stopped) {
    console.log('ℹ️  No active standalone daemon PID found.');
  }
}

function printHelp() {
  console.log(`
====================================================
🚀 BeamDrop — Standalone Deployment Tool
====================================================
Usage:
  node deploy.js <command> [options]

Commands:
  standalone   Deploy and run in background as standalone daemon
  start        Run server in foreground
  docker       Build and deploy container via Docker Compose
  systemd      Generate/install Linux systemd service unit
  status       Check server health, uptime, and active items
  stop         Stop standalone background daemon
  init         Create or update .env configuration

Options:
  --port, -p <port>        Server port (default: 3055)
  --url, -u <url>          Public domain URL (e.g. https://qr.example.com)
  --max-size, -m <mb>      Max upload size in MB (default: 150)
  --ttl, -t <minutes>      Default auto-delete TTL in minutes (default: 60)

Examples:
  node deploy.js standalone
  node deploy.js standalone --port 3055 --url https://qr.example.com
  node deploy.js docker
  node deploy.js status
  node deploy.js stop
====================================================`);
}

async function main() {
  const { command, flags } = parseArgs(process.argv);
  const env = readEnv();
  const port = parseInt(flags.PORT || env.PORT, 10) || 3055;

  switch (command) {
    case 'standalone':
    case 'background':
    case 'daemon':
      await startStandaloneDaemon(flags);
      break;
    case 'start':
    case 'foreground':
      startForeground(flags);
      break;
    case 'docker':
      await deployDocker(flags);
      break;
    case 'systemd':
    case 'service':
      generateSystemdService(flags);
      break;
    case 'status':
      await printStatus(port, env);
      break;
    case 'stop':
      stopServer();
      break;
    case 'init':
      const updated = ensureEnv(flags);
      console.log('✅ Configuration saved to .env:', updated);
      break;
    default:
      printHelp();
      break;
  }
}

main();

