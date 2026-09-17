/* hforge-api SQLite store — Phase 1 JSON -> SQLite parity layer.
   Uses the native `node:sqlite` driver (Node >= 22, no new dependency).
   app.db lives in DATA_DIR alongside secret/vapid.json, which stay on the filesystem.

   Semantics preserved 1:1 from the former db.json + state-<uid>.json storage:
   - PUT /api/data is a total replace; GET re-validates via preparePersistedState and rewrites
     opportunistically when the canonical form differs. Unknown state fields pass through
     untouched inside the user_states.document JSON column.
   - Push endpoint dedup is global: re-subscribing moves the endpoint to the new user.
   - Inactivity reminders claim once (claim -> persist -> send) and survive restarts.
   - Session-version bumps, 404/410 endpoint pruning and invite revoke (= delete) behave as before.
   All methods are synchronous. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { normalizeInactivityReminders } from './inactivity-reminders.js';
import { preparePersistedState } from './state-validation.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const APP_DB_FILE = 'app.db';
const legacyDbFile = dataDir => path.join(dataDir, 'db.json');
const legacyStateFile = (dataDir, uid) =>
  path.join(dataDir, 'state-' + String(uid).replace(/[^a-zA-Z0-9_-]/g, '') + '.json');

function applyMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
  );
  let files = [];
  try {
    files = fs.readdirSync(MIGRATIONS_DIR).filter(name => name.endsWith('.sql')).sort();
  } catch {
    return;
  }
  for (const file of files) {
    const match = file.match(/^(\d+)_.*\.sql$/);
    if (!match) continue;
    const version = Number.parseInt(match[1], 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at_ms) VALUES (?, ?)').run(version, Date.now());
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    applied.add(version);
  }
}

/* ---------- row -> legacy JSON shape ---------- */
const isSet = value => value === 1 || value === true;
function rowToUser(row) {
  const user = { id: row.id, name: row.name, created: row.created_at, sv: row.session_version };
  if (row.invited_by !== null && row.invited_by !== undefined) user.invitedBy = row.invited_by;
  if (isSet(row.disabled)) user.disabled = true;
  if (isSet(row.admin)) user.admin = true;
  if (row.last_reminder_date !== null && row.last_reminder_date !== undefined) {
    user.lastReminder = row.last_reminder_date;
  }
  return user;
}
function rowToCredential(row) {
  let transports = [];
  try {
    const parsed = JSON.parse(row.transports);
    if (Array.isArray(parsed)) transports = parsed;
  } catch {}
  return { id: row.id, userId: row.user_id, publicKey: row.public_key, counter: row.counter, transports };
}
function rowToSubscription(row) {
  return {
    userId: row.user_id, endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth }, created: row.created_at,
  };
}
function rowToInvite(row) {
  const invite = { code: row.code, note: row.note, createdBy: row.created_by, created: row.created_at };
  if (row.used_by !== null && row.used_by !== undefined) {
    invite.usedBy = row.used_by;
    invite.usedAt = row.used_at;
  }
  return invite;
}
function rowToReminder(row) {
  return {
    userId: row.user_id, sessionId: row.session_id,
    deadline: row.deadline_ms, sentAt: row.sent_at_ms, locale: row.locale,
  };
}

function hotColumns(state) {
  const reminder = state && typeof state.reminder === 'object' && state.reminder !== null ? state.reminder : null;
  return {
    lang: typeof state.lang === 'string' ? state.lang : null,
    unit: typeof state.unit === 'string' ? state.unit : null,
    reminderOn: reminder && typeof reminder.on === 'boolean' ? (reminder.on ? 1 : 0) : null,
    reminderTime: reminder && typeof reminder.time === 'string' ? reminder.time : null,
    reminderTz: reminder && typeof reminder.tz === 'string' ? reminder.tz : null,
  };
}

export function createDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, APP_DB_FILE));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  applyMigrations(db);

  const runInTransaction = fn => {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  };

  const stmts = {
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countInvites: db.prepare('SELECT COUNT(*) AS n FROM invites'),
    listUsers: db.prepare('SELECT id, name, created_at, invited_by, session_version, disabled, admin, last_reminder_date FROM users ORDER BY rowid'),
    findUser: db.prepare('SELECT id, name, created_at, invited_by, session_version, disabled, admin, last_reminder_date FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, name, created_at, invited_by, session_version, disabled, admin, last_reminder_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    upsertUser: db.prepare(`INSERT INTO users (id, name, created_at, invited_by, session_version, disabled, admin, last_reminder_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at,
        invited_by = excluded.invited_by, session_version = excluded.session_version,
        disabled = excluded.disabled, admin = excluded.admin, last_reminder_date = excluded.last_reminder_date`),
    updateUserName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
    setUserDisabled: db.prepare('UPDATE users SET disabled = ? WHERE id = ?'),
    bumpSessionVersion: db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?'),
    setUserLastReminder: db.prepare('UPDATE users SET last_reminder_date = ? WHERE id = ?'),

    findCredential: db.prepare('SELECT id, user_id, public_key, counter, transports FROM credentials WHERE id = ?'),
    insertCredential: db.prepare('INSERT INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)'),
    insertCredentialIgnored: db.prepare('INSERT OR IGNORE INTO credentials (id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)'),
    updateCredentialCounter: db.prepare('UPDATE credentials SET counter = ? WHERE id = ?'),

    listSubscriptions: db.prepare('SELECT user_id, endpoint, p256dh, auth, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY rowid'),
    hasSubscription: db.prepare('SELECT 1 AS found FROM push_subscriptions WHERE user_id = ? LIMIT 1'),
    deleteSubscriptionByEndpoint: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    deleteSubscriptionScoped: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'),
    insertSubscription: db.prepare('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)'),
    replaceSubscription: db.prepare('INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)'),

    findInvite: db.prepare('SELECT code, note, created_by, created_at, used_by, used_at FROM invites WHERE code = ?'),
    listInvites: db.prepare('SELECT code, note, created_by, created_at, used_by, used_at FROM invites ORDER BY rowid'),
    insertInvite: db.prepare('INSERT INTO invites (code, note, created_by, created_at, used_by, used_at) VALUES (?, ?, ?, ?, ?, ?)'),
    replaceInvite: db.prepare('INSERT OR REPLACE INTO invites (code, note, created_by, created_at, used_by, used_at) VALUES (?, ?, ?, ?, ?, ?)'),
    markInviteUsed: db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?'),
    deleteInvite: db.prepare('DELETE FROM invites WHERE code = ?'),

    listReminders: db.prepare('SELECT user_id, session_id, deadline_ms, sent_at_ms, locale FROM inactivity_reminders ORDER BY rowid'),
    deleteAllReminders: db.prepare('DELETE FROM inactivity_reminders'),
    replaceReminder: db.prepare('INSERT OR REPLACE INTO inactivity_reminders (user_id, session_id, deadline_ms, sent_at_ms, locale) VALUES (?, ?, ?, ?, ?)'),

    getState: db.prepare('SELECT document FROM user_states WHERE user_id = ?'),
    upsertState: db.prepare(`INSERT INTO user_states (user_id, document, updated_at_ms, lang, unit, reminder_on, reminder_time, reminder_tz)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET document = excluded.document, updated_at_ms = excluded.updated_at_ms,
        lang = excluded.lang, unit = excluded.unit, reminder_on = excluded.reminder_on,
        reminder_time = excluded.reminder_time, reminder_tz = excluded.reminder_tz`),
  };

  const writeState = (userId, state) => {
    const hot = hotColumns(state);
    const updatedAt = typeof state._ts === 'number' && Number.isFinite(state._ts) && state._ts >= 0
      ? state._ts
      : Date.now();
    stmts.upsertState.run(
      userId, JSON.stringify(state), updatedAt,
      hot.lang, hot.unit, hot.reminderOn, hot.reminderTime, hot.reminderTz
    );
  };

  const store = {
    close() { db.close(); },
    transaction(fn) { return runInTransaction(fn); },
    /* Read-only introspection for tests/ops: confirms the live connection PRAGMAs
       (journal_mode, foreign_keys, busy_timeout, synchronous). */
    pragma(name) {
      const allow = new Set(['journal_mode', 'foreign_keys', 'busy_timeout', 'synchronous']);
      if (!allow.has(name)) throw new Error('unknown pragma: ' + name);
      return db.prepare('PRAGMA ' + name).get();
    },

    /* ----- users ----- */
    countUsers() { return stmts.countUsers.get().n; },
    listUsers() { return stmts.listUsers.all().map(rowToUser); },
    findUserById(id) {
      const row = stmts.findUser.get(id);
      return row ? rowToUser(row) : null;
    },
    createUser(user) {
      stmts.insertUser.run(
        user.id, user.name, user.created, user.invitedBy || null, 0, 0, 0, null
      );
    },
    upsertUser(row) {
      stmts.upsertUser.run(
        row.id, row.name, row.created, row.invitedBy || null,
        row.sv || 0, row.disabled ? 1 : 0, row.admin ? 1 : 0, row.lastReminder || null
      );
    },
    updateUserName(id, name) { stmts.updateUserName.run(name, id); },
    setUserDisabled(id, disabled) { stmts.setUserDisabled.run(disabled ? 1 : 0, id); },
    bumpSessionVersion(id) {
      stmts.bumpSessionVersion.run(id);
      return stmts.findUser.get(id).session_version;
    },
    setUserLastReminder(id, date) { stmts.setUserLastReminder.run(date, id); },

    /* ----- credentials ----- */
    findCredentialById(id) {
      const row = stmts.findCredential.get(id);
      return row ? rowToCredential(row) : null;
    },
    createCredential(cred) {
      stmts.insertCredential.run(
        cred.id, cred.userId, cred.publicKey, cred.counter || 0, JSON.stringify(cred.transports || [])
      );
    },
    insertCredentialIgnored(cred) {
      return stmts.insertCredentialIgnored.run(
        cred.id, cred.userId, cred.publicKey, cred.counter || 0, cred.transports
      ).changes > 0;
    },
    updateCredentialCounter(id, counter) { stmts.updateCredentialCounter.run(counter, id); },

    /* ----- push subscriptions ----- */
    listUserSubscriptions(userId) { return stmts.listSubscriptions.all(userId).map(rowToSubscription); },
    hasPushSubscription(userId) { return !!stmts.hasSubscription.get(userId); },
    // Global endpoint dedup: re-subscribing moves the endpoint to the new owner.
    upsertSubscription(sub) {
      runInTransaction(() => {
        stmts.deleteSubscriptionByEndpoint.run(sub.endpoint);
        stmts.insertSubscription.run(sub.userId, sub.endpoint, sub.p256dh, sub.auth, sub.created);
      });
    },
    replaceSubscription(sub) {
      stmts.replaceSubscription.run(sub.userId, sub.endpoint, sub.p256dh, sub.auth, sub.created);
    },
    // Ownership-isolated unsubscribe: only the caller's own row goes away.
    deleteSubscription(userId, endpoint) { stmts.deleteSubscriptionScoped.run(userId, endpoint); },
    // Dead-endpoint pruning (push 404/410) is global, like the old endpoint-keyed filter.
    deletePushSubscriptionsByEndpoints(endpoints) {
      if (!endpoints.length) return;
      runInTransaction(() => {
        for (const endpoint of endpoints) stmts.deleteSubscriptionByEndpoint.run(endpoint);
      });
    },

    /* ----- invites ----- */
    findInviteByCode(code) {
      // invites.code is COLLATE NOCASE, so legacy mixed-case codes match upper-cased input.
      const row = stmts.findInvite.get(code);
      return row ? rowToInvite(row) : null;
    },
    listInvites() { return stmts.listInvites.all().map(rowToInvite); },
    createInvite(invite) {
      stmts.insertInvite.run(
        invite.code, invite.note || '', invite.createdBy, invite.created, null, null
      );
    },
    replaceInvite(invite) {
      stmts.replaceInvite.run(
        invite.code, invite.note || '', invite.createdBy, invite.created,
        invite.usedBy || null, invite.usedAt || null
      );
    },
    markInviteUsed(code, userId, usedAt) { stmts.markInviteUsed.run(userId, usedAt, code); },
    // Revocation deletes the row; there is no revoked column.
    deleteInvite(code) { stmts.deleteInvite.run(code); },

    /* ----- inactivity reminders ----- */
    // The list is tiny; callers reuse the pure helpers from inactivity-reminders.js
    // (upsert/cancel/claim) and persist the resulting list wholesale, exactly like before.
    listInactivityReminders() { return stmts.listReminders.all().map(rowToReminder); },
    saveInactivityReminders(reminders) {
      runInTransaction(() => {
        stmts.deleteAllReminders.run();
        for (const item of reminders) {
          stmts.replaceReminder.run(item.userId, item.sessionId, item.deadline, item.sentAt, item.locale);
        }
      });
    },
    replaceReminder(item) {
      stmts.replaceReminder.run(item.userId, item.sessionId, item.deadline, item.sentAt, item.locale);
    },

    /* ----- user states ----- */
    // Total replace of the canonical document plus hot-column projections.
    setUserState(userId, state) { writeState(userId, state); },
    getUserState(userId) {
      const row = stmts.getState.get(userId);
      if (!row) return null;
      let raw;
      try {
        raw = JSON.parse(row.document);
      } catch {
        return null;
      }
      const prepared = preparePersistedState(raw);
      if (!prepared.ok) return null;
      if (JSON.stringify(raw) !== JSON.stringify(prepared.state)) {
        try {
          writeState(userId, prepared.state);
        } catch {}
      }
      return prepared.state;
    },
  };

  // One-time upgrade path: a fresh database with a legacy db.json next to it imports it once,
  // so existing deployments keep working without manual steps. Afterwards app.db is the
  // source of truth and the JSON files are ignored (use scripts/migrate-json-to-sqlite.mjs
  // for an explicit, re-runnable import).
  if (stmts.countUsers.get().n === 0 && stmts.countInvites.get().n === 0) {
    if (fs.existsSync(legacyDbFile(dataDir))) {
      try {
        importLegacyData(store, dataDir);
      } catch (error) {
        console.error('legacy JSON import failed — starting with an empty database', error);
      }
    }
  }

  return store;
}

/* One-shot, idempotent legacy import. Safe to re-run: users and states converge to the JSON
   content (upsert), credentials are first-wins (INSERT OR IGNORE), and subscriptions, invites
   and reminders converge by PK/UNIQUE replace. */
export function importLegacyData(store, dataDir) {
  const counts = {
    users: 0, credentials: 0, push_subscriptions: 0,
    invites: 0, inactivity_reminders: 0, user_states: 0, skipped: 0,
  };
  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyDbFile(dataDir), 'utf8'));
  } catch {
    return counts;
  }
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return counts;
  const nowIso = new Date().toISOString();

  const knownUserIds = new Set(store.listUsers().map(user => user.id));
  for (const raw of Array.isArray(legacy.users) ? legacy.users : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) {
      counts.skipped++;
      continue;
    }
    store.upsertUser({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : '',
      created: typeof raw.created === 'string' && raw.created ? raw.created : nowIso,
      invitedBy: typeof raw.invitedBy === 'string' ? raw.invitedBy : null,
      sv: Number.isInteger(raw.sv) && raw.sv >= 0 ? raw.sv : 0,
      disabled: !!raw.disabled,
      admin: !!raw.admin,
      lastReminder: typeof raw.lastReminder === 'string' ? raw.lastReminder : null,
    });
    knownUserIds.add(raw.id);
    counts.users++;
  }

  for (const raw of Array.isArray(legacy.creds) ? legacy.creds : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id
      || typeof raw.userId !== 'string' || !knownUserIds.has(raw.userId)
      || typeof raw.publicKey !== 'string' || !raw.publicKey) {
      counts.skipped++;
      continue;
    }
    if (store.insertCredentialIgnored({
      id: raw.id,
      userId: raw.userId,
      publicKey: raw.publicKey,
      counter: Number.isInteger(raw.counter) ? raw.counter : 0,
      transports: JSON.stringify(Array.isArray(raw.transports) ? raw.transports : []),
    })) counts.credentials++;
  }

  for (const raw of Array.isArray(legacy.subs) ? legacy.subs : []) {
    const keys = raw && typeof raw === 'object' ? raw.keys : null;
    if (!raw || typeof raw !== 'object' || typeof raw.userId !== 'string' || !knownUserIds.has(raw.userId)
      || typeof raw.endpoint !== 'string' || !raw.endpoint
      || !keys || typeof keys.p256dh !== 'string' || !keys.p256dh
      || typeof keys.auth !== 'string' || !keys.auth) {
      counts.skipped++;
      continue;
    }
    store.replaceSubscription({
      userId: raw.userId,
      endpoint: raw.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      created: typeof raw.created === 'string' && raw.created ? raw.created : nowIso,
    });
    counts.push_subscriptions++;
  }

  for (const raw of Array.isArray(legacy.invites) ? legacy.invites : []) {
    // Rows soft-revoked in the JSON era (revoked flag) stay deleted: SQLite revoke = delete.
    if (!raw || typeof raw !== 'object' || typeof raw.code !== 'string' || !raw.code || raw.revoked) {
      counts.skipped++;
      continue;
    }
    const usedBy = typeof raw.usedBy === 'string' && knownUserIds.has(raw.usedBy) ? raw.usedBy : null;
    store.replaceInvite({
      code: raw.code,
      note: typeof raw.note === 'string' ? raw.note : '',
      createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
      created: typeof raw.created === 'string' && raw.created ? raw.created : nowIso,
      usedBy,
      usedAt: usedBy && typeof raw.usedAt === 'string' ? raw.usedAt : null,
    });
    counts.invites++;
  }

  for (const item of normalizeInactivityReminders(legacy.inactivityReminders)) {
    if (!knownUserIds.has(item.userId)) {
      counts.skipped++;
      continue;
    }
    store.replaceReminder(item);
    counts.inactivity_reminders++;
  }

  for (const user of store.listUsers()) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(legacyStateFile(dataDir, user.id), 'utf8'));
    } catch {
      continue; // no legacy state file for this user — not an error
    }
    const prepared = preparePersistedState(raw);
    if (!prepared.ok) {
      counts.skipped++;
      continue;
    }
    store.setUserState(user.id, prepared.state);
    counts.user_states++;
  }

  return counts;
}
