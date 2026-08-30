const LIMITS = { depth: 64, nodes: 250000, arrayItems: 100000, objectKeys: 10000 };
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const fail = (code, path) => ({ ok: false, code, path });
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const propertyPath = (parent, key) => `${parent}.${key}`;
const isoDate = value => typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

function validateStructure(value) {
  if (!plainObject(value)) return fail('invalid_root', '$');
  const seen = new WeakSet(), stack = [{ value, path: '$', depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes++;
    if (nodes > LIMITS.nodes) return fail('node_limit', current.path);
    const { value: item, path, depth } = current;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) return fail('non_finite', path);
      continue;
    }
    if (typeof item !== 'object') return fail('invalid_value', path);
    if (seen.has(item)) return fail('cycle', path);
    seen.add(item);
    if (depth > LIMITS.depth) return fail('depth_limit', path);
    if (Array.isArray(item)) {
      if (item.length > LIMITS.arrayItems) return fail('array_limit', path);
      for (let index = item.length - 1; index >= 0; index--) {
        if (!Object.hasOwn(item, index)) return fail('sparse_array', path);
        stack.push({ value: item[index], path: `${path}[${index}]`, depth: depth + 1 });
      }
      continue;
    }
    if (!plainObject(item)) return fail('non_plain_object', path);
    const keys = Object.keys(item);
    if (keys.length > LIMITS.objectKeys) return fail('object_key_limit', path);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index], childPath = propertyPath(path, key);
      if (UNSAFE_KEYS.has(key)) return fail('unsafe_key', childPath);
      stack.push({ value: item[key], path: childPath, depth: depth + 1 });
    }
  }
  return null;
}

const validId = value => typeof value === 'string' && value.trim().length > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function validateSemantic(state) {
  const check = (condition, code, path) => condition ? null : fail(code, path);
  const collection = (key, arrays) => !Object.hasOwn(state, key) || (arrays ? Array.isArray(state[key]) : plainObject(state[key]));
  for (const key of ['bodyweight', 'routines', 'workouts', 'customEx', 'blocks']) {
    const result = check(collection(key, true), 'invalid_collection', `$.${key}`); if (result) return result;
  }
  for (const key of ['week', 'dayPlan', 'exWeights']) {
    const result = check(collection(key, false), 'invalid_day_map', `$.${key}`); if (result) return result;
  }
  if (Object.hasOwn(state, 'unit') && !['kg', 'lb'].includes(state.unit)) return fail('invalid_unit', '$.unit');
  for (const key of ['_ts', 'restSec']) if (Object.hasOwn(state, key) && !nonnegative(state[key])) return fail('range', `$.${key}`);
  if (Object.hasOwn(state, 'targetW') && state.targetW !== null && !nonnegative(state.targetW)) return fail('range', '$.targetW');
  if (Object.hasOwn(state, 'reminder')) {
    const reminder = state.reminder;
    if (!plainObject(reminder)) return fail('invalid_reminder', '$.reminder');
    if (Object.hasOwn(reminder, 'on') && typeof reminder.on !== 'boolean') return fail('invalid_reminder', '$.reminder.on');
    if (Object.hasOwn(reminder, 'time') && (typeof reminder.time !== 'string' || !TIME.test(reminder.time))) return fail('invalid_time', '$.reminder.time');
    if (Object.hasOwn(reminder, 'tz') && reminder.tz !== null && typeof reminder.tz !== 'string') return fail('invalid_reminder', '$.reminder.tz');
  }
  for (let index = 0; index < (state.bodyweight || []).length; index++) {
    const item = state.bodyweight[index], base = `$.bodyweight[${index}]`;
    if (!plainObject(item) || !isoDate(item.d)) return fail('invalid_date', `${base}.d`);
    if (!nonnegative(item.w) || (Object.hasOwn(item, 't') && !nonnegative(item.t))) return fail('range', base);
  }
  for (let index = 0; index < (state.routines || []).length; index++) {
    const item = state.routines[index], base = `$.routines[${index}]`;
    if (!plainObject(item) || !validId(item.id)) return fail('invalid_id', `${base}.id`);
    if (Object.hasOwn(item, 'name') && typeof item.name !== 'string') return fail('invalid_routine', `${base}.name`);
    if (Object.hasOwn(item, 'ex') && !Array.isArray(item.ex)) return fail('invalid_collection', `${base}.ex`);
  }
  for (let index = 0; index < (state.workouts || []).length; index++) {
    const workout = state.workouts[index], base = `$.workouts[${index}]`;
    if (!plainObject(workout) || !isoDate(workout.d)) return fail('invalid_date', `${base}.d`);
    if (Object.hasOwn(workout, 'entries') && !Array.isArray(workout.entries)) return fail('invalid_collection', `${base}.entries`);
    for (let entryIndex = 0; entryIndex < (workout.entries || []).length; entryIndex++) {
      const entry = workout.entries[entryIndex], entryPath = `${base}.entries[${entryIndex}]`;
      if (!plainObject(entry) || !validId(entry.id)) return fail('invalid_id', `${entryPath}.id`);
      if (Object.hasOwn(entry, 'sets') && !Array.isArray(entry.sets)) return fail('invalid_collection', `${entryPath}.sets`);
      for (let setIndex = 0; setIndex < (entry.sets || []).length; setIndex++) {
        const set = entry.sets[setIndex], setPath = `${entryPath}.sets[${setIndex}]`;
        if (!plainObject(set)) return fail('invalid_collection', setPath);
        for (const key of ['r', 'w', 'sec', 'speed']) if (Object.hasOwn(set, key) && !nonnegative(set[key])) return fail('range', `${setPath}.${key}`);
        if (Object.hasOwn(set, 'rir') && (!Number.isInteger(set.rir) || set.rir < 0 || set.rir > 10)) return fail('range', `${setPath}.rir`);
        if (Object.hasOwn(set, 'rpe') && (!Number.isFinite(set.rpe) || set.rpe < 6 || set.rpe > 10)) return fail('range', `${setPath}.rpe`);
      }
    }
  }
  for (const [key, map] of [['week', state.week], ['dayPlan', state.dayPlan]]) {
    if (map && Object.values(map).some(value => value !== 'rest' && !validId(value))) return fail('invalid_day_map', `$.${key}`);
  }
  for (let index = 0; index < (state.blocks || []).length; index++) {
    const block = state.blocks[index], base = `$.blocks[${index}]`;
    if (!plainObject(block) || !validId(block.id) || !Array.isArray(block.weeks)) return fail('invalid_block', base);
    for (let week = 0; week < block.weeks.length; week++) if (!plainObject(block.weeks[week]) || !plainObject(block.weeks[week].days)) return fail('invalid_block', `${base}.weeks[${week}]`);
  }
  if (state.activeBlock !== undefined && state.activeBlock !== null) {
    const block = state.activeBlock;
    if (!plainObject(block) || !validId(block.blockId)) return fail('invalid_active_block', '$.activeBlock');
    if (!isoDate(block.startedOn)) return fail('invalid_date', '$.activeBlock.startedOn');
    if (!['active', 'paused'].includes(block.status)) return fail('invalid_block_status', '$.activeBlock.status');
  }
  return null;
}

export function preparePersistedState(value) {
  const structuralFailure = validateStructure(value);
  if (structuralFailure) return structuralFailure;
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'active'));
  return validateSemantic(state) || { ok: true, state };
}
