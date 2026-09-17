-- 001_init: Phase 1 JSON -> SQLite parity schema (1:1 with db.json + state-<uid>.json).
-- Secrets (secret, vapid.json) stay on the filesystem and are intentionally NOT migrated here.
-- Table/column names are plural snake_case. Booleans are 0/1 integers. No restrictive CHECK on
-- lang/tz/locale so future values never block a write; validation stays in JS (state-validation.js).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  invited_by TEXT NULL,
  session_version INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
  admin INTEGER NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
  last_reminder_date TEXT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transports))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Code is NOCASE so legacy mixed-case codes and upper-cased consumption compare equal.
-- Revocation deletes the row (there is deliberately no revoked column).
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY COLLATE NOCASE,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_by TEXT NULL REFERENCES users (id),
  used_at TEXT NULL
);

CREATE TABLE IF NOT EXISTS inactivity_reminders (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  deadline_ms INTEGER NOT NULL CHECK (deadline_ms >= 0),
  sent_at_ms INTEGER NULL CHECK (sent_at_ms IS NULL OR sent_at_ms >= 0),
  locale TEXT NOT NULL DEFAULT 'en',
  PRIMARY KEY (user_id, session_id)
);

-- document is the canonical state JSON (unknown fields preserved verbatim); the remaining
-- columns are hot query projections of it, refreshed on every replace.
CREATE TABLE IF NOT EXISTS user_states (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  document TEXT NOT NULL CHECK (json_valid(document)),
  updated_at_ms INTEGER NOT NULL,
  lang TEXT NULL,
  unit TEXT NULL,
  reminder_on INTEGER NULL CHECK (reminder_on IS NULL OR reminder_on IN (0, 1)),
  reminder_time TEXT NULL,
  reminder_tz TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_inactivity_reminders_deadline ON inactivity_reminders (deadline_ms);
