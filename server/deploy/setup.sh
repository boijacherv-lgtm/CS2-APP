#!/usr/bin/env bash
# Sets up the Stratboard server on a fresh Ubuntu VM (Oracle Cloud Always Free, Ampere/ARM or x86).
#   curl -fsSL https://raw.githubusercontent.com/boijacherv-lgtm/CS2-APP/main/server/deploy/setup.sh | bash
# Safe to run again (it updates instead).
set -euo pipefail
REPO=https://github.com/boijacherv-lgtm/CS2-APP.git
DIR="$HOME/CS2-APP"
WORKER_URL="${WORKER_URL:-https://stratboard-api.stratboard.workers.dev}"

echo "== system packages"
sudo apt-get update -y -qq
sudo apt-get install -y -qq git curl ca-certificates openssl >/dev/null

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  echo "== Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

echo "== code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only -q; else git clone -q --depth 1 "$REPO" "$DIR"; fi
cd "$DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null      # the demo parser (tools/demo.mjs)
(cd server && npm ci --omit=dev --no-audit --no-fund >/dev/null)

if [ ! -f server/.env ]; then
  TOKEN="$(openssl rand -hex 32)"
  printf 'WORKER_URL=%s\nSERVER_TOKEN=%s\n' "$WORKER_URL" "$TOKEN" > server/.env
  chmod 600 server/.env
  NEW_TOKEN=1
fi

echo "== service"
sed -e "s#__USER__#$USER#g" -e "s#__DIR__#$DIR#g" server/deploy/stratboard.service | sudo tee /etc/systemd/system/stratboard.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable stratboard >/dev/null 2>&1

echo
echo "Done. Next steps:"
if [ "${NEW_TOKEN:-}" = 1 ]; then
  echo " 1. Give the Cloudflare Worker this server's token. On your own computer, in cs2-tactics/worker, run:"
  echo "      npx wrangler secret put SERVER_TOKEN"
  echo "    and paste this when it asks (it's also in ~/CS2-APP/server/.env):"
  echo
  echo "      $(grep SERVER_TOKEN server/.env | cut -d= -f2)"
  echo
fi
echo " 2. Log in the BOT account (once):   cd ~/CS2-APP/server && npm run login"
echo " 3. Start it:                        sudo systemctl start stratboard"
echo "    Watch it work:                   journalctl -u stratboard -f"
