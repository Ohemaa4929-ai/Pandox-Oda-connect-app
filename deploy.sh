#!/usr/bin/env bash
# PANDOX ODA CONNECT — one-line deploy script
# Usage:  bash deploy.sh
# Installs Docker (if needed), copies the app to /opt/pandox-oda-connect,
# creates .env from .env.example (if missing), and starts the stack.
set -euo pipefail

APP_DIR="/opt/pandox-oda-connect"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> PANDOX ODA CONNECT deploy"

# 1. Install Docker if missing
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "==> Installing Docker Compose plugin..."
  apt-get update -y && apt-get install -y docker-compose-plugin
fi

# 2. Copy app to its home
echo "==> Copying app to $APP_DIR"
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR"/. "$APP_DIR"/
cd "$APP_DIR"

# 3. Create .env from template if missing
if [ ! -f .env ]; then
  echo "==> Creating .env from .env.example — EDIT IT with your real values!"
  cp .env.example .env
  echo "    Open $APP_DIR/.env and set: ADMIN_PASSWORD, PAYSTACK keys, SMTP/SMS/MAPS keys."
fi

# 4. Build and start
echo "==> Building and starting containers..."
docker compose up -d --build

echo ""
echo "==> Done!"
echo "    App:       http://$(hostname -I | awk '{print $1}'):3000"
echo "    Dashboard: http://$(hostname -I | awk '{print $1}'):3000/admin"
echo "    Logs:      docker compose -f $APP_DIR/docker-compose.yml logs -f"
echo ""
echo "    IMPORTANT: edit $APP_DIR/.env first if you haven't, then run:"
echo "    cd $APP_DIR && docker compose up -d --build"
