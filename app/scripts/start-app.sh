#!/usr/bin/env bash
set -euo pipefail

# Runtime config (can be overridden at execution time)
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="3003"
HOSTNAME="${HOSTNAME:-0.0.0.0}"
MEMORY_MB="1024"
APP_NAME="${APP_NAME:-nexusrwa}"

cd "$APP_DIR"

echo "[start-app] APP_DIR=$APP_DIR"
echo "[start-app] PORT=$PORT"
echo "[start-app] HOSTNAME=$HOSTNAME"
echo "[start-app] MEMORY_MB=$MEMORY_MB"
echo "[start-app] APP_NAME=$APP_NAME"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[start-app] pm2 is not installed. Install with: npm i -g pm2"
  exit 1
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  PORT="$PORT" HOSTNAME="$HOSTNAME" NODE_OPTIONS="--max-old-space-size=${MEMORY_MB}" \
    pm2 restart "$APP_NAME" --update-env
else
  PORT="$PORT" HOSTNAME="$HOSTNAME" NODE_OPTIONS="--max-old-space-size=${MEMORY_MB}" \
    pm2 start npm --name "$APP_NAME" -- start
fi

pm2 save
pm2 status "$APP_NAME"
