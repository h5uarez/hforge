#!/usr/bin/env bash
#
# backup-hforge.sh — consistent daily/weekly/monthly backups of Hforge instance data.
#
# Usage: backup-hforge.sh daily|weekly|monthly
#
# Layout on the VM:
#   SRC : /opt/hforge/data            (live instance data — never written to, only read)
#   DST : /opt/hforge/backups/<mode>  (created with 0700; archives stored with 0600)
#
# Test-only overrides (never used on the VM):
#   HFORGE_SRC           source data dir (default /opt/hforge/data)
#   HFORGE_BACKUPS_BASE  backups base dir (default /opt/hforge/backups)
#
# Prerequisites on the VM: sqlite3 CLI  (apt-get install -y sqlite3)
#
set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  daily|weekly|monthly) ;;
  *)
    echo "Usage: $0 daily|weekly|monthly" >&2
    exit 2
    ;;
esac

SRC="${HFORGE_SRC:-/opt/hforge/data}"
BASE="${HFORGE_BACKUPS_BASE:-/opt/hforge/backups}"
DST="$BASE/$MODE"
STAMP="$(date +%F_%H%M)"
OUT="$DST/hforge-data-$MODE-$STAMP.tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -d "$SRC" ] || die "source dir not found: $SRC"
mkdir -p "$DST"
chmod 700 "$DST"
log "mode=$MODE src=$SRC dst=$OUT"

# --- 1. Consistent copy of the SQLite database (preferred) -------------------
if [ -f "$SRC/app.db" ]; then
  command -v sqlite3 >/dev/null 2>&1 \
    || die "sqlite3 CLI not found — install it first: apt-get install -y sqlite3"
  log "copying app.db via sqlite3 .backup (consistent snapshot)"
  sqlite3 "$SRC/app.db" ".backup '$TMP/app.db'"
  chmod 600 "$TMP/app.db"
else
  log "WARNING: $SRC/app.db not present — falling back to legacy db.json"
fi

# --- 2. Secrets: always 0600 -------------------------------------------------
for f in secret vapid.json; do
  if [ -f "$SRC/$f" ]; then
    cp -a "$SRC/$f" "$TMP/$f"
    chmod 600 "$TMP/$f"
    log "copied $f (0600)"
  else
    log "WARNING: $SRC/$f not present — skipped"
  fi
done

# --- 3. Legacy / per-user state files, when present --------------------------
shopt -s nullglob
legacy=0
for f in "$SRC"/state-*.json; do
  cp -a "$f" "$TMP/$(basename "$f")"
  chmod 600 "$TMP/$(basename "$f")"
  legacy=$((legacy + 1))
done
[ $legacy -gt 0 ] && log "copied $legacy state-*.json file(s)"
if [ -f "$SRC/db.json" ]; then
  cp -a "$SRC/db.json" "$TMP/db.json"
  chmod 600 "$TMP/db.json"
  log "copied legacy db.json"
fi
shopt -u nullglob

# --- 4. Pack -----------------------------------------------------------------
tar -czf "$OUT" -C "$TMP" .
chmod 600 "$OUT"
log "wrote $OUT"

# --- 5. Verify (archive readable + DB integrity) ------------------------------
tar -tzf "$OUT" >/dev/null || die "verification failed: $OUT is not a readable tarball"
log "tarball lists OK"
VERIFY="$TMP/verify"
mkdir -p "$VERIFY"
tar -xzf "$OUT" -C "$VERIFY"
if [ -f "$VERIFY/app.db" ]; then
  CHECK="$(sqlite3 "$VERIFY/app.db" "PRAGMA integrity_check;")"
  [ "$CHECK" = "ok" ] || die "verification failed: integrity_check returned: $CHECK"
  log "integrity_check: ok"
else
  log "no app.db in backup (legacy db.json only) — integrity_check skipped"
fi

# --- 6. Prune old archives (ONLY after successful verification) ---------------
case "$MODE" in
  daily)   KEEP_MTIME="+7"   ;;
  weekly)  KEEP_MTIME="+28"  ;;
  monthly) KEEP_MTIME="+180" ;;
esac
log "pruning $DST/hforge-data-$MODE-*.tar.gz older than $KEEP_MTIME days"
# shellcheck disable=SC2086
find "$DST" -maxdepth 1 -type f -name "hforge-data-$MODE-*.tar.gz" -mtime $KEEP_MTIME -print -delete || \
  die "pruning failed"

log "backup complete: $OUT"
