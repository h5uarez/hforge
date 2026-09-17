/* Phase 1 JSON -> SQLite parity tests (node:test, temporary DATA_DIR).
   Covers the store directly through api/db.js without spawning the server:
   legacy fixture migration, 6-table schema, PUT round-trip canonicalization,
   reminder restart + claim-once, global endpoint dedup, invite revoke-as-delete,
   session-version bumps, and secrets staying outside the database. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDatabase, importLegacyData } from './db.js';
import {
  cancelInactivityReminder,
  claimDueInactivityReminder,
  upsertInactivityReminder,
} from './inactivity-reminders.js';

const openAppDb = dataDir => new DatabaseSync(path.join(dataDir, 'app.db'));
// node:sqlite rows use a null prototype, so spread them into plain objects for deepEqual.
const query = (dataDir, sql, params = []) => {
  const db = openAppDb(dataDir);
  try {
    return db.prepare(sql).all(...params).map(row => ({ ...row }));
  } finally {
    db.close();
  }
};
const tableNames = dataDir =>
  query(dataDir, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map(row => row.name);
const tableInfo = (dataDir, table) => query(dataDir, `PRAGMA table_info(${table})`);

const makeTempDataDir = async t => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hforge-sqlite-'));
  // One cleanup hook owns both the stores and the directory: every store is closed
  // before rm runs, so Windows never hits EBUSY on app.db. Tests register stores
  // via track() instead of adding their own t.after closers (hook order is FIFO).
  const stores = [];
  t.after(async () => {
    for (const store of stores) {
      try {
        store.close();
      } catch {}
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  return { dir, track: store => { stores.push(store); return store; } };
};

const validState = () => ({
  unit: 'kg',
  lang: 'es',
  _ts: 42,
  reminder: { on: true, time: '07:30', tz: 'Europe/Madrid' },
  routines: [{ id: 'r1', name: 'One', ex: [] }],
  week: { 1: 'r1' },
  dayPlan: {},
  exWeights: {},
  bodyweight: [],
  workouts: [{ d: '2025-01-02', entries: [] }],
});

const legacyFixture = () => ({
  users: [
    { id: 'u-ana', name: 'Ana', created: '2025-01-01T00:00:00.000Z', sv: 2, lastReminder: '2025-02-01' },
    { id: 'u-bob', name: 'Bob', created: '2025-01-02T00:00:00.000Z', invitedBy: 'WELCOME', admin: true },
  ],
  creds: [
    { id: 'cred-1', userId: 'u-ana', publicKey: 'cGsta2V5', counter: 7, transports: ['usb'] },
    { id: 'cred-1', userId: 'u-ana', publicKey: 'cGsta2V5', counter: 99, transports: [] },
    { id: 'cred-ghost', userId: 'no-such-user', publicKey: 'eA', counter: 0, transports: [] },
  ],
  subs: [
    {
      userId: 'u-ana',
      endpoint: 'https://push.example/a',
      keys: { p256dh: 'cDI1Ng', auth: 'YXV0aA' },
      created: '2025-01-03T00:00:00.000Z',
    },
  ],
  invites: [
    { code: 'WELCOME', note: 'hello', createdBy: 'u-ana', created: '2025-01-01T00:00:00.000Z' },
    { code: 'MiXeD', note: '', createdBy: 'u-ana', created: '2025-01-01T00:00:00.000Z' },
    { code: 'DEAD', note: '', createdBy: 'u-ana', created: '2025-01-01T00:00:00.000Z', revoked: true },
    { code: 'USED', note: '', createdBy: 'u-ana', created: '2025-01-01T00:00:00.000Z', usedBy: 'u-ana', usedAt: '2025-01-02T00:00:00.000Z' },
  ],
  inactivityReminders: [
    { userId: 'u-ana', sessionId: 'sess-1', deadline: 1000, sentAt: null, locale: 'es' },
    { userId: 'u-ana', sessionId: 'sess-1', deadline: 1000, sentAt: null, locale: 'es' },
    { userId: 'ghost', sessionId: 'sess-x', deadline: 1000, sentAt: null, locale: 'en' },
    'not-a-reminder',
  ],
});

test('legacy fixture migrates idempotently with normalized reminders and states', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  await fs.promises.writeFile(path.join(dataDir, 'db.json'), JSON.stringify(legacyFixture()));
  await fs.promises.writeFile(
    path.join(dataDir, 'state-u-ana.json'),
    JSON.stringify({ ...validState(), active: { local: 1 }, blocks: [1], activeBlock: 'x', myPlugin: { keep: true } }),
  );

  const store = track(createDatabase(dataDir));
  const users = store.listUsers();
  assert.equal(users.length, 2);
  const ana = store.findUserById('u-ana');
  assert.equal(ana.sv, 2);
  assert.equal(ana.lastReminder, '2025-02-01');
  assert.equal(store.findUserById('u-bob').invitedBy, 'WELCOME');

  // Credentials are first-wins; the ghost credential for an unknown user is skipped.
  assert.equal(store.findCredentialById('cred-1').counter, 7);
  assert.equal(store.findCredentialById('cred-ghost'), null);

  // Push subscriptions migrate; invites keep mixed case and drop soft-revoked rows.
  assert.equal(store.listUserSubscriptions('u-ana').length, 1);
  assert.equal(store.findInviteByCode('welcome').code, 'WELCOME');
  assert.equal(store.findInviteByCode('mixed').code, 'MiXeD');
  assert.equal(store.findInviteByCode('dead'), null);
  assert.equal(store.findInviteByCode('USED').usedBy, 'u-ana');

  // Reminders go through normalizeInactivityReminders (duplicates collapse, ghosts drop).
  assert.deepEqual(store.listInactivityReminders(), [
    { userId: 'u-ana', sessionId: 'sess-1', deadline: 1000, sentAt: null, locale: 'es' },
  ]);

  // State files go through preparePersistedState: transient keys stripped, unknowns kept.
  const state = store.getUserState('u-ana');
  assert.equal(state.myPlugin.keep, true);
  assert.equal(Object.hasOwn(state, 'active'), false);
  assert.equal(Object.hasOwn(state, 'blocks'), false);
  assert.equal(Object.hasOwn(state, 'activeBlock'), false);

  // Re-running the explicit importer converges without duplicating.
  const rerun = importLegacyData(store, dataDir);
  assert.equal(store.listUsers().length, 2);
  assert.equal(store.listInactivityReminders().length, 1);
  assert.equal(store.findCredentialById('cred-1').counter, 7);
  assert.ok(rerun.users >= 2);
});

test('schema has six parity tables, PRAGMAs, hot columns, and key constraints', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  const store = track(createDatabase(dataDir));
  store.createUser({ id: 'probe', name: 'Probe', created: new Date().toISOString() });

  for (const expected of ['users', 'credentials', 'push_subscriptions', 'invites', 'inactivity_reminders', 'user_states']) {
    assert.ok(tableNames(dataDir).includes(expected), `missing table ${expected}`);
  }

  // Connection PRAGMAs are read back on the store's own live connection:
  // busy_timeout and foreign_keys are per-connection settings, so a second
  // connection cannot observe them.
  assert.equal(String(store.pragma('journal_mode').journal_mode).toLowerCase(), 'wal');
  assert.equal(store.pragma('foreign_keys').foreign_keys, 1);
  assert.equal(store.pragma('busy_timeout').timeout, 5000);
  // synchronous = NORMAL is stored as 1 (0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA).
  assert.equal(store.pragma('synchronous').synchronous, 1);
  assert.throws(() => store.pragma('integrity_check'), /unknown pragma/);

  const columns = Object.fromEntries(tableInfo(dataDir, 'user_states').map(col => [col.name, col]));
  for (const hot of ['document', 'lang', 'unit', 'reminder_on', 'reminder_time', 'reminder_tz']) {
    assert.ok(columns[hot], `missing user_states column ${hot}`);
  }
  const inviteSql = query(dataDir, "SELECT sql FROM sqlite_master WHERE name = 'invites'")[0].sql;
  assert.match(inviteSql, /COLLATE NOCASE/i);
  assert.doesNotMatch(inviteSql, /revoked/i);
  const subSql = query(dataDir, "SELECT sql FROM sqlite_master WHERE name = 'push_subscriptions'")[0].sql;
  assert.match(subSql, /endpoint[^,]*UNIQUE/i);
  const reminderPk = tableInfo(dataDir, 'inactivity_reminders').filter(col => col.pk > 0).map(col => col.name).sort();
  assert.deepEqual(reminderPk, ['session_id', 'user_id']);
  const indexes = query(dataDir, "SELECT name FROM sqlite_master WHERE type = 'index'").map(row => row.name);
  assert.ok(indexes.some(name => name.includes('credentials')));
  assert.ok(indexes.some(name => name.includes('push_subscriptions')));
  assert.ok(indexes.some(name => name.includes('inactivity_reminders')));
});

test('PUT is a total replace and GET revalidates, rewrites, and projects hot columns', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  const store = track(createDatabase(dataDir));
  store.createUser({ id: 'u1', name: 'Uno', created: new Date().toISOString() });

  store.setUserState('u1', { ...validState(), myPlugin: { keep: 'yes' } });
  const first = store.getUserState('u1');
  assert.equal(first.myPlugin.keep, 'yes');

  // Total replace: fields absent from the new document disappear.
  const next = { ...validState(), lang: 'en', myPlugin: { keep: 'no' } };
  delete next.bodyweight;
  store.setUserState('u1', next);
  const replaced = store.getUserState('u1');
  assert.equal(replaced.lang, 'en');
  assert.equal(replaced.myPlugin.keep, 'no');
  assert.equal(Object.hasOwn(replaced, 'bodyweight'), false);

  // Transient client-only keys never persist, even if written directly.
  const rawDb = openAppDb(dataDir);
  try {
    rawDb.prepare('UPDATE user_states SET document = ? WHERE user_id = ?').run(
      JSON.stringify({ ...validState(), active: { local: 1 }, blocks: [{ id: 'b' }] }),
      'u1',
    );
  } finally {
    rawDb.close();
  }
  const revalidated = store.getUserState('u1');
  assert.equal(Object.hasOwn(revalidated, 'active'), false);
  assert.equal(Object.hasOwn(revalidated, 'blocks'), false);
  const reread = query(dataDir, 'SELECT document FROM user_states WHERE user_id = ?', ['u1'])[0].document;
  assert.equal(Object.hasOwn(JSON.parse(reread), 'active'), false);

  const hot = query(
    dataDir,
    'SELECT lang, unit, reminder_on AS reminderOn, reminder_time AS reminderTime, reminder_tz AS reminderTz FROM user_states WHERE user_id = ?',
    ['u1'],
  )[0];
  assert.deepEqual(hot, { lang: 'es', unit: 'kg', reminderOn: 1, reminderTime: '07:30', reminderTz: 'Europe/Madrid' });
});

test('reminders survive restart and claim exactly once', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  let store = track(createDatabase(dataDir));
  store.createUser({ id: 'u1', name: 'Uno', created: new Date().toISOString() });

  // Schedule through the same pure helpers the server uses.
  let scheduled = upsertInactivityReminder([], 'u1', { sessionId: 'sess-1', deadline: 5000, locale: 'en' });
  assert.equal(scheduled.changed, true);
  store.saveInactivityReminders(scheduled.reminders);

  // Restart: close and reopen the same DATA_DIR; the job must still be pending.
  store.close();
  store = track(createDatabase(dataDir));
  assert.deepEqual(store.listInactivityReminders(), [
    { userId: 'u1', sessionId: 'sess-1', deadline: 5000, sentAt: null, locale: 'en' },
  ]);

  // Claim -> persist -> claim again: the second claim finds nothing (claim-once).
  const claim = claimDueInactivityReminder(store.listInactivityReminders(), 6000);
  assert.ok(claim.job);
  store.saveInactivityReminders(claim.reminders);
  const reclaimed = claimDueInactivityReminder(store.listInactivityReminders(), 6000);
  assert.equal(reclaimed.job, null);

  // Restart after the send: the sent marker persists, and cancel clears it.
  store.close();
  store = track(createDatabase(dataDir));
  assert.equal(store.listInactivityReminders()[0].sentAt, 6000);
  const cancelled = cancelInactivityReminder(store.listInactivityReminders(), 'u1', 'sess-1');
  assert.equal(cancelled.changed, true);
  store.saveInactivityReminders(cancelled.reminders);
  assert.deepEqual(store.listInactivityReminders(), []);
});

test('push endpoints dedup globally and prune by endpoint', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  const store = track(createDatabase(dataDir));
  for (const id of ['u1', 'u2']) store.createUser({ id, name: id, created: new Date().toISOString() });

  // Re-subscribing the same endpoint moves it to the new owner (global UNIQUE).
  store.upsertSubscription({ userId: 'u1', endpoint: 'https://push.example/shared', p256dh: 'cDE', auth: 'c2U', created: '2025-01-01T00:00:00.000Z' });
  store.upsertSubscription({ userId: 'u2', endpoint: 'https://push.example/shared', p256dh: 'cDE', auth: 'c2U', created: '2025-01-02T00:00:00.000Z' });
  assert.deepEqual(store.listUserSubscriptions('u1'), []);
  assert.equal(store.listUserSubscriptions('u2').length, 1);

  // Ownership-isolated unsubscribe leaves the other owner's rows alone.
  store.upsertSubscription({ userId: 'u1', endpoint: 'https://push.example/solo', p256dh: 'cDE', auth: 'c2U', created: '2025-01-01T00:00:00.000Z' });
  store.deleteSubscription('u2', 'https://push.example/solo');
  assert.equal(store.listUserSubscriptions('u1').length, 1);

  // Dead-endpoint pruning (push 404/410) removes across owners.
  store.deletePushSubscriptionsByEndpoints(['https://push.example/shared', 'https://push.example/solo']);
  assert.deepEqual(store.listUserSubscriptions('u1'), []);
  assert.deepEqual(store.listUserSubscriptions('u2'), []);
});

test('invites revoke by delete and session versions bump like logout-all', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  const store = track(createDatabase(dataDir));
  store.createUser({ id: 'admin', name: 'Admin', created: new Date().toISOString() });
  store.createUser({ id: 'member', name: 'Member', created: new Date().toISOString() });

  store.createInvite({ code: 'AbC123', note: 'n', createdBy: 'admin', created: new Date().toISOString() });
  assert.equal(store.findInviteByCode('abc123').code, 'AbC123');
  store.markInviteUsed('AbC123', 'member', new Date().toISOString());
  assert.equal(store.findInviteByCode('ABC123').usedBy, 'member');

  // Revocation deletes the row; there is no revoked column to inspect.
  store.createInvite({ code: 'TEMP', note: '', createdBy: 'admin', created: new Date().toISOString() });
  store.deleteInvite('temp');
  assert.equal(store.findInviteByCode('TEMP'), null);
  assert.doesNotMatch(
    query(dataDir, "SELECT sql FROM sqlite_master WHERE name = 'invites'")[0].sql,
    /revoked/i,
  );

  // logout-all semantics: each bump invalidates the previous session version.
  assert.equal(store.findUserById('member').sv, 0);
  assert.equal(store.bumpSessionVersion('member'), 1);
  assert.equal(store.bumpSessionVersion('member'), 2);
  assert.equal(store.findUserById('member').sv, 2);
});

test('secret and vapid stay as files, never as database tables or columns', async t => {
  const { dir: dataDir, track } = await makeTempDataDir(t);
  await fs.promises.writeFile(path.join(dataDir, 'secret'), 'file-secret');
  await fs.promises.writeFile(
    path.join(dataDir, 'vapid.json'),
    JSON.stringify({ publicKey: 'pub', privateKey: 'priv' }),
  );
  const store = track(createDatabase(dataDir));
  store.createUser({ id: 'u1', name: 'Uno', created: new Date().toISOString() });

  const names = tableNames(dataDir).filter(name => !name.startsWith('sqlite_') && name !== 'schema_migrations');
  assert.deepEqual(names.sort(), [
    'credentials',
    'inactivity_reminders',
    'invites',
    'push_subscriptions',
    'user_states',
    'users',
  ]);
  const columnNames = names.flatMap(name => tableInfo(dataDir, name).map(col => col.name.toLowerCase()));
  assert.equal(columnNames.some(name => name.includes('secret') || name.includes('vapid')), false);
  assert.equal(await fs.promises.readFile(path.join(dataDir, 'secret'), 'utf8'), 'file-secret');
  assert.deepEqual(JSON.parse(await fs.promises.readFile(path.join(dataDir, 'vapid.json'), 'utf8')), {
    publicKey: 'pub',
    privateKey: 'priv',
  });
});
