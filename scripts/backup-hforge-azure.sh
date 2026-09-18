#!/usr/bin/env bash
#
# backup-hforge-azure.sh — daily local backup + off-VM upload to Azure Blob.
#
# What it does:
#   1. Runs /opt/hforge/backup-hforge.sh daily (consistent sqlite .backup + tar.gz 0600 + verify + prune 7d).
#   2. Uploads the newest daily tarball to Storage hforgebackups01 / container hforge-backups
#      with managed-identity login (no secrets). Blob lifecycle deletes after 14 days.
#
# Infra (already created 2026-09-18):
#   StorageV2 LRS Hot westeurope, container hforge-backups (private),
#   lifecycle rule delete-after-14d on prefix hforge-backups/hforge-data-,
#   VM system-assigned identity + role "Storage Blob Data Contributor" scoped to the account.
#
# Cron (VM): 0 3 * * * /opt/hforge/backup-hforge-azure.sh >>/var/log/hforge-backup.log 2>&1
#
set -euo pipefail

ACCOUNT="hforgebackups01"
CONTAINER="hforge-backups"
LOCAL_SCRIPT="/opt/hforge/backup-hforge.sh"
BASE="${HFORGE_BACKUPS_BASE:-/opt/hforge/backups}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

command -v az >/dev/null 2>&1 || die "az CLI not found on VM"
[ -x "$LOCAL_SCRIPT" ] || die "local backup script not executable: $LOCAL_SCRIPT"

log "running local daily backup"
"$LOCAL_SCRIPT" daily

LATEST="$(ls -t "$BASE/daily"/hforge-data-daily-*.tar.gz 2>/dev/null | head -1)"
[ -n "${LATEST:-}" ] || die "no daily tarball found in $BASE/daily"
log "latest: $LATEST"

log "az login with VM managed identity"
az login --identity --output none 2>&1 | tail -2 || die "az login --identity failed"

BLOB="$(basename "$LATEST")"
log "uploading $BLOB to $ACCOUNT/$CONTAINER (overwrite)"
az storage blob upload \
  --account-name "$ACCOUNT" \
  --container-name "$CONTAINER" \
  --name "$BLOB" \
  --file "$LATEST" \
  --auth-mode login \
  --overwrite true \
  --output none || die "blob upload failed"

log "azure backup complete: $BLOB (lifecycle deletes after 14d)"
