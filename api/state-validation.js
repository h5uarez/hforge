const LIMITS = { depth: 64, nodes: 250000, arrayItems: 100000, objectKeys: 10000 };
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_DATE_TIMESTAMP = 8640000000000000;

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
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const modes = new Set(['reps', 'time', 'cardio']);

function validateWorkoutTimestamps(workout, base) {
  const hasStart = Object.hasOwn(workout, 'start'), hasEnd = Object.hasOwn(workout, 'end');
  if (!hasStart && !hasEnd) return null;
  const start = hasStart ? workout.start : 0, end = hasEnd ? workout.end : 0;
  if (start === 0 && end === 0) return null;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= 0
    || start > MAX_DATE_TIMESTAMP || end > MAX_DATE_TIMESTAMP
    || new Date(start).getTime() !== start || new Date(end).getTime() !== end)
    return fail('invalid_timestamp', base);
  if (end < start) return fail('timestamp_order', `${base}.end`);
  return null;
}

function validateEffortFields(value, path) {
  if (Object.hasOwn(value, 'rir') && (!Number.isFinite(value.rir) || value.rir < 0 || value.rir > 10))
    return fail('range', `${path}.rir`);
  if (Object.hasOwn(value, 'rpe') && (!Number.isFinite(value.rpe) || value.rpe < 5 || value.rpe > 10))
    return fail('range', `${path}.rpe`);
  return null;
}

function validateSideSet(value, mode, path) {
  if (!plainObject(value)) return fail('invalid_collection', path);
  for (const key of ['r', 'w', 'speed'])
    if (Object.hasOwn(value, key) && !nonnegative(value[key])) return fail('range', `${path}.${key}`);
  if (Object.hasOwn(value, 'done') && typeof value.done !== 'boolean') return fail('invalid_done', `${path}.done`);
  if (Object.hasOwn(value, 'sec') && !positiveInteger(value.sec)) return fail('range', `${path}.sec`);
  if (Object.hasOwn(value, 'min') && !positiveInteger(value.min)) return fail('range', `${path}.min`);
  const effort = validateEffortFields(value, path); if (effort) return effort;
  if (Object.hasOwn(value, 'left') || Object.hasOwn(value, 'right')) {
    if (!plainObject(value.left) || !plainObject(value.right)) return fail('invalid_side', path);
    const left = validateSideSet(value.left, mode, `${path}.left`); if (left) return left;
    return validateSideSet(value.right, mode, `${path}.right`);
  }
  if (mode === 'cardio') {
    if (!positiveInteger(value.min)) return fail('range', `${path}.min`);
    if (!Object.hasOwn(value, 'speed') || !nonnegative(value.speed)) return fail('range', `${path}.speed`);
  } else if (mode === 'time') {
    if (!positiveInteger(value.sec)) return fail('range', `${path}.sec`);
  }
  return null;
}

function validateHistoryTarget(value, mode, path) {
  if (!plainObject(value)) return fail('invalid_target', path);
  if (Object.hasOwn(value, 'mode') && !modes.has(value.mode)) return fail('invalid_mode', `${path}.mode`);
  for (const key of ['weight', 'bodyweight']) {
    if (Object.hasOwn(value, key) && (key === 'bodyweight' ? typeof value[key] !== 'boolean' : !nonnegative(value[key])))
      return fail('range', `${path}.${key}`);
  }
  if (Object.hasOwn(value, 'sets') && !positiveInteger(value.sets)) return fail('range', `${path}.sets`);
  if (Object.hasOwn(value, 'reps') && (!Number.isFinite(value.reps) || value.reps < 1)) return fail('range', `${path}.reps`);
  if (Object.hasOwn(value, 'repsBySet') && (!Array.isArray(value.repsBySet) || value.repsBySet.some(item => item != null && (!Number.isFinite(item) || item < 1))))
    return fail('range', `${path}.repsBySet`);
  if (Object.hasOwn(value, 'sec') && !positiveInteger(value.sec)) return fail('range', `${path}.sec`);
  if (Object.hasOwn(value, 'min') && !positiveInteger(value.min)) return fail('range', `${path}.min`);
  if (Object.hasOwn(value, 'speed') && !nonnegative(value.speed)) return fail('range', `${path}.speed`);
  if (Object.hasOwn(value, 'side') && typeof value.side !== 'boolean') return fail('invalid_side', `${path}.side`);
  return null;
}

function validateSemantic(state) {
  const check = (condition, code, path) => condition ? null : fail(code, path);
  const collection = (key, arrays) => !Object.hasOwn(state, key) || (arrays ? Array.isArray(state[key]) : plainObject(state[key]));
  for (const key of ['bodyweight', 'routines', 'workouts', 'customEx']) {
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
    const timestampFailure = validateWorkoutTimestamps(workout, base); if (timestampFailure) return timestampFailure;
    if (Object.hasOwn(workout, 'entries') && !Array.isArray(workout.entries)) return fail('invalid_collection', `${base}.entries`);
    for (let entryIndex = 0; entryIndex < (workout.entries || []).length; entryIndex++) {
      const entry = workout.entries[entryIndex], entryPath = `${base}.entries[${entryIndex}]`;
      if (!plainObject(entry) || !validId(entry.id)) return fail('invalid_id', `${entryPath}.id`);
      const mode = entry.mode || entry.target?.mode || 'reps';
      if (!modes.has(mode)) return fail('invalid_mode', `${entryPath}.mode`);
      const target = entry.target || Object.fromEntries(['mode', 'sets', 'reps', 'repsBySet', 'weight', 'bodyweight', 'side', 'sec', 'min', 'speed']
        .filter(key => Object.hasOwn(entry, key) && (key !== 'sets' || Number.isSafeInteger(entry[key]))).map(key => [key, entry[key]]));
      const targetFailure = validateHistoryTarget(target, mode, `${entryPath}.target`); if (targetFailure) return targetFailure;
      if (Object.hasOwn(entry, 'sets') && !Array.isArray(entry.sets)) return fail('invalid_collection', `${entryPath}.sets`);
      for (let setIndex = 0; setIndex < (entry.sets || []).length; setIndex++) {
        const set = entry.sets[setIndex], setPath = `${entryPath}.sets[${setIndex}]`;
        const setFailure = validateSideSet(set, mode, setPath); if (setFailure) return setFailure;
      }
    }
  }
  for (const [key, map] of [['week', state.week], ['dayPlan', state.dayPlan]]) {
    if (map && Object.values(map).some(value => value !== 'rest' && !validId(value))) return fail('invalid_day_map', `$.${key}`);
  }
  return null;
}

const withoutWorkoutSnapshot = workout => {
  if (!plainObject(workout)) return workout;
  const clean = { ...workout };
  delete clean.block;
  return clean;
};

function cleanPersistedState(value) {
  const state = Object.fromEntries(Object.entries(value).filter(([key]) => !['active', 'blocks', 'activeBlock'].includes(key)));
  if (Array.isArray(state.workouts)) state.workouts = state.workouts.map(withoutWorkoutSnapshot);
  return state;
}

export function preparePersistedState(value) {
  const structuralFailure = validateStructure(value);
  if (structuralFailure) return structuralFailure;
  const state = cleanPersistedState(value);
  return validateSemantic(state) || { ok: true, state };
}
