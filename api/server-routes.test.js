import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('.', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const freePort = async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
};

const request = (port, method, requestPath, { body, cookie, raw } = {}) => new Promise((resolve, reject) => {
  const payload = raw === undefined ? (body === undefined ? null : JSON.stringify(body)) : raw;
  const req = http.request({
    host: '127.0.0.1', port, path: requestPath, method,
    headers: {
      ...(payload !== null && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }),
      ...(cookie && { Cookie: cookie }),
    },
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      resolve({ status: res.statusCode, body: parsed, headers: res.headers });
    });
  });
  req.once('error', reject);
  if (payload !== null) req.write(payload);
  req.end();
});

const startServer = async (data, env = {}) => {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], {
      cwd: apiDirectory,
      env: { ...process.env, DATA_DIR: data, PORT: String(port), ORIGIN: 'http://localhost', ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let poll = 0; poll < 200; poll++) {
      try {
        await request(port, 'GET', '/api/health');
        return { child, exited, output: () => output, port };
      } catch (error) {
        lastError = error;
        await delay(25);
      }
    }
    child.kill();
    await Promise.race([exited, delay(2000)]);
  }
  throw new Error(`server did not become ready: ${lastError}`);
};

const stopServer = async server => {
  if (!server.child.killed) server.child.kill();
  await Promise.race([server.exited, delay(2000)]);
};

const signedCookie = (uid, secret, { expiry = Date.now() + 300_000, version = 0, includeVersion = true } = {}) => {
  const payload = includeVersion ? `${uid}:${expiry}:${version}` : `${uid}:${expiry}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `gymsid=${payload}.${signature}`;
};

const createFixture = async (t, options = {}) => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'hforge-routes-'));
  const secret = 'route-test-secret';
  const users = options.users || [
    { id: 'admin', name: 'Administrator', sv: 0, created: '2026-01-01T00:00:00.000Z' },
    { id: 'member', name: 'Member', sv: 0, created: '2026-01-02T00:00:00.000Z' },
  ];
  const db = { users, creds: [], subs: [], invites: [], ...(options.db || {}) };
  await writeFile(path.join(data, 'secret'), secret);
  await writeFile(path.join(data, 'db.json'), JSON.stringify(db));
  const server = await startServer(data, { ADMIN_UIDS: 'admin', ...(options.env || {}) });
  t.after(async () => {
    await stopServer(server);
    await rm(data, { recursive: true, force: true });
  });
  return {
    data, secret, server,
    adminCookie: signedCookie('admin', secret),
    memberCookie: signedCookie('member', secret),
  };
};

const responseBody = response => ({ status: response.status, body: response.body });

test('public routes expose stable JSON, cache policy, configuration, and 404 behavior', async t => {
  const { server } = await createFixture(t, { env: { INVITE_ONLY: 'true' } });

  const health = await request(server.port, 'GET', '/api/health?ignored=yes');
  assert.deepEqual(responseBody(health), { status: 200, body: { ok: true, users: 2 } });
  assert.equal(health.headers['content-type'], 'application/json');
  assert.equal(health.headers['cache-control'], 'no-store');
  assert.deepEqual(responseBody(await request(server.port, 'GET', '/api/config')), {
    status: 200, body: { invite_only: true },
  });
  assert.deepEqual(responseBody(await request(server.port, 'GET', '/missing')), {
    status: 404, body: { error: 'not found' },
  });
  assert.deepEqual(responseBody(await request(server.port, 'POST', '/api/health')), {
    status: 404, body: { error: 'not found' },
  });
});

test('session cookies reject tampering, expiry, unknown users, disabled users, and wrong versions', async t => {
  const { secret, server, adminCookie, memberCookie } = await createFixture(t, {
    users: [
      { id: 'admin', name: 'Administrator', sv: 0 },
      { id: 'member', name: 'Member', sv: 2 },
      { id: 'disabled', name: 'Disabled', sv: 0, disabled: true },
      { id: 'legacy', name: 'Legacy' },
    ],
  });
  const me = pathCookie => request(server.port, 'GET', '/api/me', { cookie: pathCookie });

  assert.deepEqual(responseBody(await me(adminCookie)), {
    status: 200, body: { user: { id: 'admin', name: 'Administrator', admin: true } },
  });
  assert.equal((await me(memberCookie)).status, 401);
  assert.equal((await me(signedCookie('member', secret, { version: 2 }))).status, 200);
  assert.equal((await me(signedCookie('legacy', secret, { includeVersion: false }))).status, 200);
  assert.equal((await me(signedCookie('member', secret, { version: 1 }))).status, 401);
  assert.equal((await me(signedCookie('member', secret, { expiry: 0, version: 2 }))).status, 401);
  assert.equal((await me(signedCookie('missing', secret))).status, 401);
  assert.equal((await me(signedCookie('disabled', secret))).status, 401);
  assert.equal((await me(adminCookie.slice(0, -1) + 'x')).status, 401);
  assert.equal((await me('other=value; gymsid=malformed')).status, 401);
});

test('logout clears only the browser cookie while logout-all revokes every session durably', async t => {
  const { data, secret, server, memberCookie } = await createFixture(t);

  const logout = await request(server.port, 'POST', '/api/logout', { cookie: memberCookie, body: {} });
  assert.deepEqual(responseBody(logout), { status: 200, body: { ok: true } });
  assert.match(logout.headers['set-cookie'][0], /^gymsid=; Path=\/; Max-Age=0; HttpOnly;/);
  assert.equal((await request(server.port, 'GET', '/api/me', { cookie: memberCookie })).status, 200);

  const revoked = await request(server.port, 'POST', '/api/logout/all', { cookie: memberCookie, body: {} });
  assert.equal(revoked.status, 200);
  assert.equal((await request(server.port, 'GET', '/api/me', { cookie: memberCookie })).status, 401);
  assert.equal((await request(server.port, 'POST', '/api/logout/all', { cookie: memberCookie, body: {} })).status, 401);
  const db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.equal(db.users.find(user => user.id === 'member').sv, 1);
  assert.equal((await request(server.port, 'GET', '/api/me', { cookie: signedCookie('member', secret, { version: 1 }) })).status, 200);
});

test('profile updates enforce authentication, validation, and mutation boundaries', async t => {
  const fixture = await createFixture(t);
  const { data, memberCookie } = fixture;

  assert.equal((await request(fixture.server.port, 'PATCH', '/api/me', { body: { name: 'No session' } })).status, 401);
  assert.deepEqual(responseBody(await request(fixture.server.port, 'PATCH', '/api/me', { cookie: memberCookie, body: { name: '   ' } })), {
    status: 400, body: { error: 'name required' },
  });
  assert.equal((await request(fixture.server.port, 'PATCH', '/api/me', { cookie: memberCookie, body: { name: 'x'.repeat(41) } })).status, 400);
  const malformed = await request(fixture.server.port, 'PATCH', '/api/me', { cookie: memberCookie, raw: '{bad' });
  assert.notEqual(Math.floor(malformed.status / 100), 2);
  let db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.equal(db.users.find(user => user.id === 'member').name, 'Member');
  const renamed = await request(fixture.server.port, 'PATCH', '/api/me', { cookie: memberCookie, body: { name: '  New Name  ' } });
  assert.equal(renamed.body.user.name, 'New Name');

  db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.equal(db.users.find(user => user.id === 'member').name, 'New Name');
});

test('oversized JSON bodies are never accepted and do not terminate the server', async t => {
  const { server, memberCookie } = await createFixture(t);
  const oversized = JSON.stringify({ name: 'x'.repeat(5 * 1024 * 1024) });

  try {
    const response = await request(server.port, 'PATCH', '/api/me', { cookie: memberCookie, raw: oversized });
    assert.notEqual(response.status, 200);
  } catch (error) {
    assert.ok(['ECONNRESET', 'EPIPE'].includes(error.code), `unexpected transport error: ${error.code}`);
  }
  assert.equal((await request(server.port, 'GET', '/api/health')).status, 200);
});

test('push subscription routes validate input and isolate unsubscribe ownership', async t => {
  const { data, server, adminCookie, memberCookie } = await createFixture(t);
  const endpoint = 'https://push.example/device';
  const subscription = { endpoint, keys: { p256dh: 'valid_key-1', auth: 'valid_key-2' } };

  assert.equal((await request(server.port, 'POST', '/api/push/subscribe', { body: { subscription } })).status, 401);
  for (const invalid of [
    null,
    { endpoint: 'http://push.example/device', keys: subscription.keys },
    { endpoint, keys: { p256dh: 'bad key', auth: 'ok' } },
    { endpoint, keys: { p256dh: 'ok', auth: '' } },
  ]) {
    assert.equal((await request(server.port, 'POST', '/api/push/subscribe', { cookie: memberCookie, body: { subscription: invalid } })).status, 400);
  }
  assert.equal((await request(server.port, 'POST', '/api/push/subscribe', { cookie: memberCookie, body: { subscription } })).status, 200);
  assert.equal((await request(server.port, 'POST', '/api/push/subscribe', { cookie: adminCookie, body: { subscription } })).status, 200);
  assert.equal((await request(server.port, 'POST', '/api/push/unsubscribe', { cookie: memberCookie, body: { endpoint } })).status, 200);
  let db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.deepEqual(db.subs.map(sub => ({ userId: sub.userId, endpoint: sub.endpoint })), [{ userId: 'admin', endpoint }]);
  assert.equal((await request(server.port, 'POST', '/api/push/unsubscribe', { cookie: adminCookie, body: { endpoint, extra: true } })).status, 400);
  assert.equal((await request(server.port, 'POST', '/api/push/unsubscribe', { cookie: adminCookie, body: { endpoint } })).status, 200);
  db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.deepEqual(db.subs, []);
});

test('rest timer boundaries require auth and activity exposes bounded live presence to admins', async t => {
  const { server, adminCookie, memberCookie } = await createFixture(t);

  assert.equal((await request(server.port, 'POST', '/api/push/rest-timer', { body: { seconds: 30 } })).status, 401);
  assert.equal((await request(server.port, 'POST', '/api/push/rest-timer/cancel', { body: {} })).status, 401);
  assert.equal((await request(server.port, 'POST', '/api/push/rest-timer', { cookie: memberCookie, body: { seconds: 1 } })).status, 200);
  assert.equal((await request(server.port, 'POST', '/api/push/rest-timer', { cookie: memberCookie, body: { seconds: 3600 } })).status, 200);
  assert.equal((await request(server.port, 'POST', '/api/push/rest-timer/cancel', { cookie: memberCookie, body: {} })).status, 200);

  assert.equal((await request(server.port, 'POST', '/api/activity', { body: { active: true } })).status, 401);
  assert.equal((await request(server.port, 'GET', '/api/admin/users', { cookie: memberCookie })).status, 403);
  await request(server.port, 'POST', '/api/activity', {
    cookie: memberCookie,
    body: { active: true, name: 'N'.repeat(80), exIdx: '2', exTotal: 5, setsDone: 3, setsTotal: 9, startedAt: 123 },
  });
  let users = (await request(server.port, 'GET', '/api/admin/users', { cookie: adminCookie })).body.users;
  const member = users.find(user => user.id === 'member');
  assert.deepEqual({ ...member.live, updatedAt: 0 }, {
    name: 'N'.repeat(60), exIdx: 2, exTotal: 5, setsDone: 3, setsTotal: 9, startedAt: 123, updatedAt: 0,
  });
  await request(server.port, 'POST', '/api/activity', { cookie: memberCookie, body: { active: false } });
  users = (await request(server.port, 'GET', '/api/admin/users', { cookie: adminCookie })).body.users;
  assert.equal(users.find(user => user.id === 'member').live, null);
});

test('admin user and invite routes enforce roles, mutation guards, ordering, and persistence', async t => {
  const { data, server, adminCookie, memberCookie } = await createFixture(t, {
    db: { invites: [{ code: 'USED', usedBy: 'member', createdBy: 'admin' }] },
  });
  await writeFile(path.join(data, 'state-member.json'), JSON.stringify({
    unit: 'lb', _ts: 50, reminder: { on: false, time: '08:00', tz: null },
    routines: [{ id: 'r1', name: 'Routine', emoji: 'A', ex: [{ id: 'squat' }] }],
    week: {}, dayPlan: {}, exWeights: {}, bodyweight: [{ d: '2026-01-01', w: 80, t: 1 }],
    workouts: [{ d: '2026-01-01', entries: [] }, { d: '2026-01-02', entries: [] }],
  }));

  assert.equal((await request(server.port, 'GET', '/api/admin/invites')).status, 401);
  assert.equal((await request(server.port, 'GET', '/api/admin/invites', { cookie: memberCookie })).status, 403);
  const detail = await request(server.port, 'GET', '/api/admin/user?id=member', { cookie: adminCookie });
  assert.equal(detail.body.unit, 'lb');
  assert.deepEqual(detail.body.workouts.map(workout => workout.d), ['2026-01-02', '2026-01-01']);
  assert.deepEqual(detail.body.routines, [{ id: 'r1', name: 'Routine', emoji: 'A', count: 1 }]);
  assert.equal((await request(server.port, 'GET', '/api/admin/user?id=missing', { cookie: adminCookie })).status, 404);
  assert.equal((await request(server.port, 'POST', '/api/admin/user/disable', { cookie: adminCookie, body: { id: 'admin', disabled: true } })).status, 400);

  const created = await request(server.port, 'POST', '/api/admin/invites/new', {
    cookie: adminCookie, body: { note: 'n'.repeat(80) },
  });
  assert.match(created.body.invite.code, /^[A-F0-9]{16}$/);
  assert.equal(created.body.invite.note.length, 60);
  assert.equal((await request(server.port, 'POST', '/api/admin/invites/revoke', { cookie: adminCookie, body: { code: 'used' } })).status, 400);
  assert.equal((await request(server.port, 'POST', '/api/admin/invites/revoke', { cookie: adminCookie, body: { code: created.body.invite.code.toLowerCase() } })).status, 200);
  assert.equal((await request(server.port, 'POST', '/api/admin/invites/revoke', { cookie: adminCookie, body: { code: 'missing' } })).status, 404);

  const disabled = await request(server.port, 'POST', '/api/admin/user/disable', {
    cookie: adminCookie, body: { id: 'member', disabled: true },
  });
  assert.deepEqual(responseBody(disabled), { status: 200, body: { ok: true, id: 'member', disabled: true } });
  assert.equal((await request(server.port, 'GET', '/api/me', { cookie: memberCookie })).status, 401);
  const db = JSON.parse(await readFile(path.join(data, 'db.json'), 'utf8'));
  assert.equal(db.users.find(user => user.id === 'member').disabled, true);
  assert.deepEqual(db.invites.map(invite => invite.code), ['USED']);
});

test('invite-only registration options reject malformed and unauthorized requests before WebAuthn verification', async t => {
  const { server } = await createFixture(t, {
    env: { INVITE_ONLY: 'yes' },
    db: { invites: [{ code: 'OPEN-CODE', note: '', createdBy: 'admin' }] },
  });

  assert.equal((await request(server.port, 'POST', '/api/register/options', { body: { name: '   ', code: 'OPEN-CODE' } })).status, 400);
  assert.equal((await request(server.port, 'POST', '/api/register/options', { body: { name: 'New User', code: 'wrong' } })).status, 403);
  const accepted = await request(server.port, 'POST', '/api/register/options', { body: { name: '  New User  ', code: 'open-code' } });
  assert.equal(accepted.status, 200);
  assert.equal(typeof accepted.body.cid, 'string');
  assert.equal(accepted.body.options.user.name, 'New User');
  assert.equal(accepted.body.options.rp.id, 'localhost');
});
