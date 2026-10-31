#!/usr/bin/env bash
# ==============================================================================
# BeamDrop — Universal Standalone & Docker Deployment Tool
# Works with either Node.js (standalone) OR Docker (containerized)
#
# Usage:
#   ./deploy.sh [command] [options]
#
# Commands:
#   standalone   Deploy as standalone background daemon (Node.js) or Docker fallback
#   docker       Build and deploy container via Docker Compose
#   start        Run server in foreground
#   systemd      Generate/install Linux systemd service unit
#   status       Check server health, uptime, and active items
#   stop         Stop running standalone daemon or Docker container
#   init         Create or update .env configuration
#
# Options:
#   --port, -p <port>        Server port (default: 3055)
#   --url, -u <url>          Public domain URL (e.g. https://qr.example.com)
#   --max-size, -m <mb>      Max upload size in MB (default: 150)
#   --ttl, -t <minutes>      Default auto-delete TTL in minutes (default: 60)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# If Node.js is installed on the host, delegate to deploy.js
if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/deploy.js" "$@"
fi

# Fallback: Pure Bash + Docker handler when Node.js is not installed on host
CMD="help"
PORT_ARG=""
URL_ARG=""
MAX_SIZE_ARG=""
TTL_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    standalone|docker|start|status|stop|init|help)
      CMD="$1"
      shift
      ;;
    --standalone|-s)
      CMD="standalone"
      shift
      ;;
    --docker|-d)
      CMD="docker"
      shift
      ;;
    --status)
      CMD="status"
      shift
      ;;
    --stop)
      CMD="stop"
      shift
      ;;
    --port|-p)
      PORT_ARG="$2"
      shift 2
      ;;
    --url|-u)
      URL_ARG="$2"
      shift 2
      ;;
    --max-size|-m)
      MAX_SIZE_ARG="$2"
      shift 2
      ;;
    --ttl|-t)
      TTL_ARG="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# Ensure .env exists
if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
fi

# Load current .env values
PORT=3055
MAX_FILE_SIZE_MB=150
FILE_TTL_MINUTES=60
PUBLIC_URL=""
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env" 2>/dev/null || true
fi

# Apply flag overrides
[ -n "$PORT_ARG" ] && PORT="$PORT_ARG"
[ -n "$URL_ARG" ] && PUBLIC_URL="$URL_ARG"
[ -n "$MAX_SIZE_ARG" ] && MAX_FILE_SIZE_MB="$MAX_SIZE_ARG"
[ -n "$TTL_ARG" ] && FILE_TTL_MINUTES="$TTL_ARG"

write_env() {
  cat > "$SCRIPT_DIR/.env" <<EOF
# BeamDrop Standalone Configuration
PORT=${PORT}
MAX_FILE_SIZE_MB=${MAX_FILE_SIZE_MB}
FILE_TTL_MINUTES=${FILE_TTL_MINUTES}
PUBLIC_URL=${PUBLIC_URL}
EOF
}

if [ -n "$PORT_ARG" ] || [ -n "$URL_ARG" ] || [ -n "$MAX_SIZE_ARG" ] || [ -n "$TTL_ARG" ]; then
  write_env
fi

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LAN_IP" ] && LAN_IP="localhost"

case "$CMD" in
  init)
    write_env
    echo "✅ Configuration saved to .env"
    cat "$SCRIPT_DIR/.env"
    ;;
  docker|standalone|start)
    if ! command -v docker >/dev/null 2>&1; then
      echo "❌ Error: Neither Node.js nor Docker is installed."
      exit 1
    fi
    echo "🐳 Building and deploying BeamDrop via Docker Compose..."
    docker compose up -d --build
    sleep 2
    echo "===================================================="
    echo "✅ BeamDrop is deployed and running!"
    echo "🌐 Local URL:   http://localhost:${PORT}"
    echo "📱 Network URL: http://${LAN_IP}:${PORT}"
    if [ -n "$PUBLIC_URL" ]; then
      echo "🌍 Public URL:  ${PUBLIC_URL}"
    fi
    echo "===================================================="
    ;;
  status)
    echo "===================================================="
    echo "📊 BeamDrop Server Status"
    echo "===================================================="
    if command -v curl >/dev/null 2>&1; then
      HEALTH=$(curl -s "http://127.0.0.1:${PORT}/health" || true)
      if [ -n "$HEALTH" ]; then
        echo "Health Check: 🟢 ONLINE -> $HEALTH"
      else
        echo "Health Check: 🔴 OFFLINE on port ${PORT}"
      fi
    fi
    if command -v docker >/dev/null 2>&1; then
      docker ps --filter "name=beamdrop"
    fi
    echo "===================================================="
    ;;
  stop)
    if command -v docker >/dev/null 2>&1; then
      echo "🛑 Stopping BeamDrop Docker container..."
      docker compose down
    fi
    ;;
  *)
    cat <<EOF
====================================================
🚀 BeamDrop — Standalone & Docker Deployment Tool
====================================================
Usage:
  ./deploy.sh <command> [options]

Commands:
  standalone   Deploy server (Node.js daemon or Docker Compose)
  docker       Build and deploy via Docker Compose
  status       Check server health and active transfers/links
  stop         Stop running server
  init         Create or update .env configuration

Options:
  --port, -p <port>        Server port (default: 3055)
  --url, -u <url>          Public domain URL (e.g. https://qr.example.com)
  --max-size, -m <mb>      Max upload size in MB (default: 150)
  --ttl, -t <minutes>      Default auto-delete TTL in minutes (default: 60)

Examples:
  ./deploy.sh standalone
  ./deploy.sh docker --port 3055 --url https://qr.example.com
  ./deploy.sh status
  ./deploy.sh stop
====================================================
EOF
    ;;
esac
