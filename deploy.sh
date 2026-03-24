#!/usr/bin/env bash
set -euo pipefail

# --- Config ---
REMOTE_HOST="root@192.168.10.25"
SSH_KEY="$HOME/.ssh/id_ed25519_unraid"
APP_DIR="/mnt/user/appdata/watch-webbed-films"
CONTAINER="watch-webbed-films"
DOMAIN="watch.webbedfilms.com"

# --- Pre-deploy: check for active transcodes ---
echo "==> Checking for active transcodes..."
ACTIVE=$(ssh -i "$SSH_KEY" "$REMOTE_HOST" "curl -sf http://localhost:3500/health 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get(\"activeTranscodes\",0))' 2>/dev/null || echo 0")
if [ "$ACTIVE" != "0" ]; then
  echo "==> WARNING: $ACTIVE active transcode(s) running. Deploy will kill them."
  read -p "   Continue? [y/N] " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { echo "==> Deploy aborted."; exit 1; }
fi

# --- Local: commit & push ---
echo "==> Committing locally..."
git add admin/ public/ deploy.sh docker-compose.yml tools/ CLAUDE.md
git add -u  # stage modifications to tracked files only
git commit -m "Deploy $(date '+%Y-%m-%d %H:%M:%S')" || echo "Nothing to commit"
echo "==> Pushing to GitHub..."
git push origin main

# --- Remote: backup database before restart ---
echo "==> Backing up database..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" "
  mkdir -p $APP_DIR/backups
  cp $APP_DIR/data/watch.db $APP_DIR/backups/watch_\$(date +%Y%m%d_%H%M%S).db
  ls -t $APP_DIR/backups/watch_*.db 2>/dev/null | tail -n +31 | xargs -r rm
  echo 'Backup complete (keeping last 30)'
"

# --- Rsync to Unraid ---
echo "==> Syncing files to Unraid..."
rsync -avz \
  -e "ssh -i $SSH_KEY" \
  admin/ "$REMOTE_HOST:$APP_DIR/admin/"
rsync -avz \
  -e "ssh -i $SSH_KEY" \
  public/ "$REMOTE_HOST:$APP_DIR/public/"
rsync -avz \
  -e "ssh -i $SSH_KEY" \
  tools/ "$REMOTE_HOST:$APP_DIR/tools/"
rsync -avz \
  -e "ssh -i $SSH_KEY" \
  deploy.sh docker-compose.yml CLAUDE.md "$REMOTE_HOST:$APP_DIR/"

# --- Remote: restart container ---
echo "==> Restarting container..."
ssh -i "$SSH_KEY" "$REMOTE_HOST" "cd $APP_DIR && docker restart $CONTAINER"

# --- Wait for service health ---
echo "==> Waiting for service to start..."
for i in $(seq 1 30); do
  if ssh -i "$SSH_KEY" "$REMOTE_HOST" "curl -sf http://localhost:3500/health" > /dev/null 2>&1; then
    echo "==> Service healthy!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "==> WARNING: Service did not become healthy in 30s"
  fi
  sleep 1
done

# --- Cloudflare cache purge ---
if [ -n "${CF_API_TOKEN:-}" ]; then
  echo "==> Purging Cloudflare cache for $DOMAIN..."
  ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=webbedfilms.com" \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    result = data.get('result')
    if result and len(result) > 0:
        print(result[0]['id'])
    else:
        print('ZONE_NOT_FOUND', file=sys.stderr)
        sys.exit(1)
except Exception as e:
    print(f'Parse error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1)

  if [ $? -ne 0 ] || [ -z "$ZONE_ID" ] || [[ "$ZONE_ID" == *"error"* ]]; then
    echo "==> WARNING: Could not get zone ID ($ZONE_ID), skipping cache purge"
  else
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    if r.get('success'):
        print('Cache purged')
    else:
        errors = r.get('errors', [])
        print(f'Cache purge failed: {errors}')
except Exception as e:
    print(f'Cache purge response parse error: {e}')
"
  fi
else
  echo "==> Skipping cache purge (CF_API_TOKEN not set)"
fi

echo "==> Deploy complete!"
