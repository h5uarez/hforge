# Hforge backups (VM: daily / weekly / monthly)

Scheduled, verifiable backups of the production instance data at `/opt/hforge/data`,
taken with `scripts/backup-hforge.sh` and pruned automatically. Cron is the scheduler;
the script only ever **reads** the live data dir.

## What is backed up

Each run produces one archive:

```
/opt/hforge/backups/<mode>/hforge-data-<mode>-YYYY-MM-DD_HHMM.tar.gz   (0600)
```

| Content | How | Notes |
|---|---|---|
| `app.db` | Consistent snapshot via `sqlite3 "$SRC/app.db" ".backup '$TMP/app.db'"` | Preferred source. A plain `cp` of a live SQLite file can copy a torn page; `.backup` takes a transactional snapshot instead. |
| `secret` | `cp -a`, chmod 0600 | Session-signing secret. **Anyone holding it can forge sessions.** |
| `vapid.json` | `cp -a`, chmod 0600 | Web Push keys (auto-generated on first run). |
| `state-*.json` | `cp -a` if present, chmod 0600 | Per-user state files (transitional; kept while they exist). |
| `db.json` | `cp -a` if present, chmod 0600 | Legacy JSON database. Copied as fallback when `app.db` is absent and kept alongside it during the migration window. |

Every archive is verified before it counts: `tar -tzf` must list cleanly **and**
`PRAGMA integrity_check` on the archived `app.db` must return `ok`.
Pruning runs **only** after verification succeeds, so a failed run never deletes
older good backups.

## Retention and sizes

| Mode | Cron | Keeps archives newer than | Steady-state copies |
|---|---|---|---|
| `daily` | `30 2 * * *` | 7 days (`-mtime +7`) | 7 |
| `weekly` | `20 3 * * 0` | 28 days (`-mtime +28`) | 4 |
| `monthly` | `10 4 1 * *` | 180 days (`-mtime +180`) | 6 |

Estimated size: each tarball is well under **85 MB** (SQLite + JSON compress well;
a typical instance is KB-scale). Steady state is ~17 archives on disk.

Prerequisite on the VM: the `sqlite3` CLI (used for `.backup` and `integrity_check`).

## Installation on the VM

Run over SSH (as a user with sudo; paths assume the compose project lives in
`/opt/hforge` with its data volume at `/opt/hforge/data`):

```bash
apt-get install -y sqlite3
sudo mkdir -p /opt/hforge/backups/{daily,weekly,monthly}
sudo chmod 700 /opt/hforge/backups /opt/hforge/backups/*
```

Copy the script from the repo checkout into place and lock it down:

```bash
sudo cp scripts/backup-hforge.sh /opt/hforge/backup-hforge.sh
sudo chmod 750 /opt/hforge/backup-hforge.sh
sudo /opt/hforge/backup-hforge.sh daily   # smoke test; check stdout ends in "backup complete"
```

Then register the three cron lines with `sudo crontab -e`:

```cron
30 2 * * * /opt/hforge/backup-hforge.sh daily   >>/var/log/hforge-backup.log 2>&1
20 3 * * 0 /opt/hforge/backup-hforge.sh weekly  >>/var/log/hforge-backup.log 2>&1
10 4 1 * * /opt/hforge/backup-hforge.sh monthly >>/var/log/hforge-backup.log 2>&1
```

```bash
sudo touch /var/log/hforge-backup.log && sudo chmod 600 /var/log/hforge-backup.log
```

## Monthly restore test (in /tmp — never touches prod)

Do this once a month. It validates the newest archive end to end without
stopping or modifying the running instance.

```bash
LATEST=$(ls -t /opt/hforge/backups/daily/hforge-data-daily-*.tar.gz | head -1)
echo "Testing: $LATEST"
rm -rf /tmp/hforge-restore-test && mkdir -p /tmp/hforge-restore-test
tar -xzf "$LATEST" -C /tmp/hforge-restore-test
ls -l /tmp/hforge-restore-test            # expect app.db, secret, vapid.json (all 0600)
sqlite3 /tmp/hforge-restore-test/app.db "PRAGMA integrity_check;"   # must print: ok
sqlite3 /tmp/hforge-restore-test/app.db "SELECT COUNT(*) FROM users;"
sqlite3 /tmp/hforge-restore-test/app.db "SELECT COUNT(*) FROM user_states;"
stat -c '%a %n' /tmp/hforge-restore-test/secret /tmp/hforge-restore-test/vapid.json  # expect 600 600
rm -rf /tmp/hforge-restore-test
```

Pass criteria: `integrity_check` returns `ok`, the user/state counts look sane
against the live instance, and secrets are `0600`. If anything fails, keep the
previous known-good archives (pruning only deletes older files, never the newest
failure) and investigate before the next scheduled run.

## Real restore (disaster only — downtime expected)

```bash
cd /opt/hforge
docker compose stop api
sudo cp -a /opt/hforge/data /opt/hforge/data.broken-$(date +%F_%H%M)  # preserve the wreckage
BACKUP=/opt/hforge/backups/weekly/hforge-data-weekly-<STAMP>.tar.gz  # pick newest verified
sudo rm -rf /opt/hforge/data && sudo mkdir -p /opt/hforge/data
sudo tar -xzf "$BACKUP" -C /opt/hforge/data
sudo chmod 700 /opt/hforge/data
sudo chmod 600 /opt/hforge/data/app.db /opt/hforge/data/secret /opt/hforge/data/vapid.json
sudo chown -R <api-uid>:<api-gid> /opt/hforge/data   # match the api service user
docker compose up -d
curl http://localhost:8080/api/health                # {"ok":true,...}
```

## SECURITY

- A backup contains `secret`: whoever reads the archive can forge sessions.
  Backup dirs are `0700`, archives and their contents are `0600`, and the cron
  log is `0600`. Restrict VM access accordingly.
- Backups must **never** be committed to the repo, uploaded to GHCR, or pasted
  into issues/logs. They live only under `/opt/hforge/backups/`.
- Deploy never touches `/opt/hforge/data`: no compose volume re-creation, no
  image change, and no CI step may delete or overwrite the data dir — otherwise a
  deploy could wipe the very files these backups protect.
