#!/usr/bin/env bash
# Pulls the latest code and restarts the service:  ~/CS2-APP/server/deploy/update.sh
set -euo pipefail
cd "$HOME/CS2-APP"
git pull --ff-only -q
npm ci --omit=dev --no-audit --no-fund >/dev/null
(cd server && npm ci --omit=dev --no-audit --no-fund >/dev/null)
sudo systemctl restart stratboard
echo "Updated to $(git log -1 --format='%h %s'). Logs: journalctl -u stratboard -f"
