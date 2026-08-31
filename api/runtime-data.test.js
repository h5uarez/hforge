import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('.', import.meta.url));
const validState = () => ({
  unit: 'kg', _ts: 1, reminder: { on: false, time: '08:00', tz: null }, routines: [{ id: 'r1', name: 'One', ex: [] }],
  week: { 1: 'r1' }, dayPlan: {}, exWeights: {}, bodyweight: [], workouts: [{ d: '2025-01-02', entries: [], block: { id: 'legacy' } }], blocks: [],
  activeBlock: { blockId: 'legacy', status: 'stopped' },
  active: { local: { extension: true } }, legacyExtension: { nested: ['retained'] }
});

const freePort = async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const request = (port, method, body, cookie) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: '/api/data', method, headers: { ...(payload && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }), ...(cookie && { Cookie: cookie }) } }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  req.once('error', reject); if (payload) req.write(payload); req.end();
});

const startServer = async data => {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePort();
    const child = spawn(process.execPath, ['server.js'], { cwd: apiDirectory, env: { ...process.env, DATA_DIR: data, PORT: String(port), ORIGIN: 'http://localhost' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let poll = 0; poll < 200; poll++) {
      try { await request(port, 'GET'); return { child, exited, port }; } catch (error) { lastError = error; await delay(25); }
    }
    child.kill();
    await Promise.race([exited, delay(2000)]);
    lastError = new Error(`attempt ${attempt + 1} did not become ready: ${output} ${lastError}`);
  }
  throw lastError;
};

test('real signed-cookie state writes preserve canonical bytes and reject invalid submissions without mutation', async t => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'hforge-data-'));
  const uid = 'runtime-user', secret = 'runtime-test-secret';
  await writeFile(path.join(data, 'secret'), secret);
  await writeFile(path.join(data, 'db.json'), JSON.stringify({ users: [{ id: uid, name: 'Runtime', sv: 0 }], creds: [], subs: [], invites: [] }));
  t.after(() => rm(data, { recursive: true, force: true }));
  const { child, exited, port } = await startServer(data);
  t.after(async () => {
    if (!child.killed) child.kill();
    await Promise.race([exited, delay(2000)]);
  });
  assert.equal((await request(port, 'GET')).status, 401);
  const payload = `${uid}:${Date.now() + 60000}:0`;
  const cookie = `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
  const submitted = validState();
  assert.deepEqual(await request(port, 'PUT', { state: submitted }, cookie), { status: 200, body: { ok: true, ts: 1 } });
  const canonical = Object.fromEntries(Object.entries(submitted).filter(([key]) => !['active', 'blocks', 'activeBlock'].includes(key)));
  canonical.workouts = canonical.workouts.map(workout => Object.fromEntries(Object.entries(workout).filter(([key]) => key !== 'block')));
  assert.deepEqual(await request(port, 'GET', undefined, cookie), { status: 200, body: { state: canonical } });
  const saved = await readFile(path.join(data, `state-${uid}.json`));
  const invalid = [
    (() => { const state = validState(); Object.defineProperty(state.active.local, 'constructor', { value: true, enumerable: true }); return state; })(),
    (() => { const state = validState(); state.routines = {}; return state; })(),
    (() => { const state = validState(); state._ts = -1; return state; })(),
    (() => { const state = validState(); state.unit = 'stone'; return state; })(),
    (() => { const state = validState(); state.reminder.time = '25:00'; return state; })(),
    (() => { const state = validState(); state.routines[0].id = ''; return state; })(),
    (() => { const state = validState(); state.workouts = [{ d: 'not-a-date' }]; return state; })(),
    (() => { const state = validState(); state.week = []; return state; })(),
    (() => { const state = validState(); state.active.items = Array(100001).fill(null); return state; })()
  ];
  for (const state of invalid) {
    const response = await request(port, 'PUT', { state }, cookie);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'invalid state');
    assert.equal(typeof response.body.code, 'string');
    assert.equal(typeof response.body.path, 'string');
    assert.deepEqual(await readFile(path.join(data, `state-${uid}.json`)), saved);
  }
});
