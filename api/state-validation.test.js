import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePersistedState } from './state-validation.js';

const validState = () => ({
  unit: 'kg', restSec: 90, _ts: 1, reminder: { on: false, time: '08:00', tz: null },
  bodyweight: [{ d: '2025-01-02', w: 72.5, t: 1 }],
  routines: [{ id: 'full-body', name: 'Full body', emoji: '🏋️', ex: [{ id: 'squat', sets: 3, reps: 5, showRir: true }] }],
  week: { 1: 'full-body' }, dayPlan: { '2025-01-02': 'full-body' }, exWeights: { squat: 100 },
  workouts: [{ d: '2025-01-02', entries: [{ id: 'squat', sets: [{ r: 5, w: 100, rir: 2 }] }], block: { id: 'legacy' } }],
  customEx: [], blocks: [{ id: 'base', weeks: [{ days: { 1: 'full-body' } }] }],
  activeBlock: { blockId: 'base', startedOn: '2025-01-02', status: 'active' },
  legacy: { showRir: true, nested: { retained: ['safe'] } }, active: { workout: { id: 'local-only' } }
});

const unsafe = (key, path = 'legacy.nested') => {
  const state = validState();
  const target = path.split('.').reduce((value, part) => value[part], state);
  Object.defineProperty(target, key, { value: true, enumerable: true });
  return state;
};

test('prepares the canonical projection and removes legacy training-block state', () => {
  const input = validState();
  const before = structuredClone(input);
  const result = preparePersistedState(input);
  const canonical = Object.fromEntries(Object.entries(before).filter(([key]) => !['active', 'blocks', 'activeBlock'].includes(key)));
  canonical.workouts = canonical.workouts.map(workout => Object.fromEntries(Object.entries(workout).filter(([key]) => key !== 'block')));
  assert.deepEqual(result, { ok: true, state: canonical });
  assert.deepEqual(input, before);
  assert.equal(Object.hasOwn(result.state, 'active'), false);
  assert.deepEqual(result.state.legacy, before.legacy);
});

test('rejects prototype keys anywhere in the raw submission, including active', () => {
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    for (const path of ['legacy.nested', 'active.workout']) {
      const result = preparePersistedState(unsafe(key, path));
      assert.deepEqual(result, { ok: false, code: 'unsafe_key', path: `$.${path}.${key}` });
    }
  }
});

test('rejects non-finite, non-plain, cyclic, sparse, and over-budget raw values', () => {
  const cases = [];
  const nonFinite = validState(); nonFinite.active.value = Infinity; cases.push(['non_finite', nonFinite, '$.active.value']);
  const nonPlain = validState(); nonPlain.active.date = new Date(); cases.push(['non_plain_object', nonPlain, '$.active.date']);
  const cyclic = validState(); cyclic.active.self = cyclic.active; cases.push(['cycle', cyclic, '$.active.self']);
  const sparse = validState(); sparse.active.items = new Array(1); cases.push(['sparse_array', sparse, '$.active.items']);
  const tooManyItems = validState(); tooManyItems.active.items = Array(100001).fill(null); cases.push(['array_limit', tooManyItems, '$.active.items']);
  const tooManyKeys = validState(); tooManyKeys.active.keys = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`k${i}`, null])); cases.push(['object_key_limit', tooManyKeys, '$.active.keys']);
  const tooDeep = validState(); let cursor = tooDeep.active; for (let i = 0; i < 65; i++) cursor = cursor.next = {}; cases.push(['depth_limit', tooDeep, '$.active' + '.next'.repeat(64)]);
  for (const [code, state, path] of cases) assert.deepEqual(preparePersistedState(state), { ok: false, code, path });
});

test('rejects invalid known collections and server-relied semantic ranges', () => {
  const cases = [
    ['invalid_collection', state => { state.routines = {}; }, '$.routines'],
    ['invalid_unit', state => { state.unit = 'stone'; }, '$.unit'],
    ['range', state => { state._ts = -1; }, '$._ts'],
    ['range', state => { state.workouts[0].entries[0].sets[0].rir = 11; }, '$.workouts[0].entries[0].sets[0].rir'],
    ['invalid_time', state => { state.reminder.time = '25:00'; }, '$.reminder.time'],
    ['invalid_date', state => { state.workouts[0].d = 'not-a-date'; }, '$.workouts[0].d'],
    ['invalid_id', state => { state.routines[0].id = ''; }, '$.routines[0].id'],
    ['invalid_day_map', state => { state.week = []; }, '$.week'],
  ];
  for (const [code, mutate, path] of cases) {
    const state = validState(); mutate(state);
    assert.deepEqual(preparePersistedState(state), { ok: false, code, path });
  }
});
