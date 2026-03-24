#!/usr/bin/env bash
# SQLite backup — run via cron on Unraid
DB="/app/data/watch.db"
BACKUP_DIR="/videos/backups"
DATE=$(date '+%Y-%m-%d_%H%M')
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB" ".backup '$BACKUP_DIR/watch_${DATE}.db'"
# Keep only last 30 backups
ls -t "$BACKUP_DIR"/watch_*.db 2>/dev/null | tail -n +31 | xargs rm -f 2>/dev/null
echo "[Backup] watch.db backed up to $BACKUP_DIR/watch_${DATE}.db"
