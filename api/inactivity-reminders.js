export const INACTIVITY_THRESHOLD_MS = 15 * 60 * 1000;
export const ACTIVE_INACTIVITY_TAG = 'active-inactivity';

const MAX_TOKEN_LENGTH = 128;
const MAX_LOCALE_LENGTH = 16;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const LOCALES = new Set(['en', 'es']);

const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const safeToken = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH && SAFE_TOKEN.test(value);
const safeTime = value => Number.isSafeInteger(value) && value >= 0;

export function normalizePushLocale(value) {
  if (typeof value !== 'string' || value.length > MAX_LOCALE_LENGTH) return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  const primary = normalized.split('-')[0];
  return LOCALES.has(normalized) ? normalized : (LOCALES.has(primary) ? primary : null);
}

export function validateInactivitySchedule(body) {
  if (!plainObject(body)) return { ok: false, error: 'invalid request' };
  const keys = Object.keys(body);
  if (keys.some(key => !['sessionId', 'deadline', 'locale'].includes(key))) return { ok: false, error: 'invalid request' };
  if (!safeToken(body.sessionId)) return { ok: false, error: 'session id required' };
  if (!safeTime(body.deadline)) return { ok: false, error: 'deadline required' };
  const locale = body.locale === undefined ? 'en' : normalizePushLocale(body.locale);
  if (!locale) return { ok: false, error: 'unsupported locale' };
  return { ok: true, value: { sessionId: body.sessionId, deadline: body.deadline, locale } };
}

export function validateInactivitySession(body) {
  if (!plainObject(body) || Object.keys(body).some(key => key !== 'sessionId'))
    return { ok: false, error: 'invalid request' };
  if (!safeToken(body.sessionId)) return { ok: false, error: 'session id required' };
  return { ok: true, value: { sessionId: body.sessionId } };
}

function normalizeReminder(value) {
  if (!plainObject(value) || !safeToken(value.userId) || !safeToken(value.sessionId) || !safeTime(value.deadline)) return null;
  const sentAt = value.sentAt === null || value.sentAt === undefined ? null : (safeTime(value.sentAt) ? value.sentAt : null);
  const locale = normalizePushLocale(value.locale) || 'en';
  return { userId: value.userId, sessionId: value.sessionId, deadline: value.deadline, sentAt, locale };
}

// A malformed or old db.json must not prevent the API from starting. Duplicate keys are
// collapsed, preferring a sent marker so a legacy duplicate cannot re-arm a fired reminder.
export function normalizeInactivityReminders(value) {
  if (!Array.isArray(value)) return [];
  const byKey = new Map();
  for (const raw of value) {
    const reminder = normalizeReminder(raw);
    if (!reminder) continue;
    const key = reminder.userId + '\0' + reminder.sessionId;
    const previous = byKey.get(key);
    if (!previous || (previous.sentAt === null && reminder.sentAt !== null)) byKey.set(key, reminder);
    else if (previous.sentAt === null && reminder.deadline >= previous.deadline) byKey.set(key, reminder);
  }
  return [...byKey.values()];
}

export function upsertInactivityReminder(reminders, userId, input) {
  const index = reminders.findIndex(item => item.userId === userId && item.sessionId === input.sessionId);
  if (index >= 0) {
    const current = reminders[index];
    if (current.sentAt !== null) return { reminders, job: current, status: 'sent', changed: false };
    // A delayed request from an older edit must not move a newer deadline backwards.
    if (input.deadline < current.deadline) return { reminders, job: current, status: 'pending', changed: false };
    const job = { userId, ...input, sentAt: null };
    const next = reminders.slice(); next[index] = job;
    return { reminders: next, job, status: 'pending', changed: true };
  }
  const job = { userId, ...input, sentAt: null };
  return { reminders: [...reminders, job], job, status: 'pending', changed: true };
}

export function cancelInactivityReminder(reminders, userId, sessionId) {
  const next = reminders.filter(item => !(item.userId === userId && item.sessionId === sessionId));
  return { reminders: next, changed: next.length !== reminders.length };
}

// Claiming is separate from sending: the caller persists this returned list before making any
// network request. A second interval tick therefore sees sentAt and cannot send the same job.
export function claimDueInactivityReminder(reminders, now) {
  if (!safeTime(now)) return { reminders, job: null };
  const index = reminders.findIndex(item => item.sentAt === null && item.deadline <= now);
  if (index < 0) return { reminders, job: null };
  const job = { ...reminders[index], sentAt: now };
  const next = reminders.slice(); next[index] = job;
  return { reminders: next, job };
}

export function publicInactivityStatus(job) {
  if (!job) return { status: 'none' };
  return {
    status: job.sentAt === null ? 'pending' : 'sent',
    sessionId: job.sessionId,
    deadline: job.deadline,
    sentAt: job.sentAt,
    locale: job.locale,
  };
}

export function buildInactivityPushPayload(locale) {
  const copy = normalizePushLocale(locale) === 'es'
    ? {
        title: 'Hforge',
        body: '¿Sigues ahí? Tu entrenamiento te espera.',
      }
    : {
        title: 'Hforge',
        body: 'Still there? Your workout awaits.',
      };
  return { kind: 'active-inactivity', tag: ACTIVE_INACTIVITY_TAG, ...copy };
}

export function pushOriginCapable(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' || (url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}
