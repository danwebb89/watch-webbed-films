#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
REMOTE_HOST="root@192.168.10.25"
SSH_KEY="$HOME/.ssh/id_ed25519_unraid"
APP_DIR="/mnt/user/appdata/watch-webbed-films"
CONTAINER="watch-webbed-films"
DOMAIN="watch.webbedfilms.com"

# --- Local: commit & push ---
echo "==> Committing and pushing..."
git add -A
git commit -m "Deploy $(date '+%Y-%m-%d %H:%M:%S')" || echo "Nothing to commit"
git push

# --- Remote: pull & restart ---
echo "==> Pulling on Unraid and restarting container..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" "cd $APP_DIR && git pull && docker restart $CONTAINER"

# --- Cloudflare cache purge ---
if [ -n "${CF_API_TOKEN:-}" ]; then
  echo "==> Purging Cloudflare cache for $DOMAIN..."
  ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=webbedfilms.com" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])")

  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{"purge_everything":true}' | python3 -c "import sys,json; r=json.load(sys.stdin); print('Cache purged' if r['success'] else f'Failed: {r}')"
else
  echo "==> Skipping cache purge (CF_API_TOKEN not set)"
fi

echo "==> Deploy complete!"
