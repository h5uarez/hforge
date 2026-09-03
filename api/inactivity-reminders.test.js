import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInactivityPushPayload, claimDueInactivityReminder, cancelInactivityReminder,
  normalizeInactivityReminders, publicInactivityStatus, pushOriginCapable,
  upsertInactivityReminder, validateInactivitySchedule, validateInactivitySession,
} from './inactivity-reminders.js';

const first = { userId: 'user-a', sessionId: 'workout-a', deadline: 1_700_000_900_000, sentAt: null, locale: 'en' };

test('validates bounded schedule and session inputs', () => {
  assert.deepEqual(validateInactivitySchedule({ sessionId: 'workout-a', deadline: first.deadline, locale: 'es-MX' }), {
    ok: true, value: { sessionId: 'workout-a', deadline: first.deadline, locale: 'es' }
  });
  for (const body of [
    null,
    { sessionId: 'bad id', deadline: first.deadline },
    { sessionId: 'workout-a', deadline: 1.5 },
    { sessionId: 'workout-a', deadline: first.deadline, locale: 'fr' },
    { sessionId: 'workout-a', deadline: first.deadline, extra: true },
  ]) assert.equal(validateInactivitySchedule(body).ok, false);
  assert.equal(validateInactivitySession({ sessionId: 'workout-a' }).ok, true);
  assert.equal(validateInactivitySession({ sessionId: 'workout-a', deadline: first.deadline }).ok, false);
});

test('loads legacy reminder metadata safely and collapses duplicate keys', () => {
  assert.deepEqual(normalizeInactivityReminders([
    first,
    { ...first, deadline: first.deadline + 1, locale: 'es' },
    { ...first, sentAt: first.deadline + 2 },
    { userId: 'user-a', sessionId: 'bad id', deadline: first.deadline },
    { userId: 'user-a', sessionId: 'broken', deadline: 'later' },
  ]), [{ ...first, sentAt: first.deadline + 2 }]);
  assert.deepEqual(normalizeInactivityReminders(undefined), []);
  assert.deepEqual(normalizeInactivityReminders({}), []);
});

test('replaces pending deadlines, cancels by owner key, and preserves sent jobs', () => {
  const created = upsertInactivityReminder([], first.userId, first);
  const replacement = upsertInactivityReminder(created.reminders, first.userId, {
    sessionId: first.sessionId, deadline: first.deadline + 1000, locale: 'es'
  });
  assert.equal(replacement.status, 'pending');
  assert.equal(replacement.job.deadline, first.deadline + 1000);
  assert.equal(replacement.job.locale, 'es');
  const sent = { ...replacement.job, sentAt: first.deadline + 2000 };
  const kept = upsertInactivityReminder([sent], first.userId, {
    sessionId: first.sessionId, deadline: first.deadline + 3000, locale: 'en'
  });
  assert.equal(kept.status, 'sent');
  assert.equal(kept.job.deadline, first.deadline + 1000);
  const cancelled = cancelInactivityReminder([sent], first.userId, first.sessionId);
  assert.equal(cancelled.changed, true);
  assert.deepEqual(cancelled.reminders, []);
});

test('claims exactly one due job before the caller sends it', () => {
  const later = { ...first, sessionId: 'workout-b', deadline: first.deadline + 1000 };
  const claimed = claimDueInactivityReminder([first, later], first.deadline);
  assert.equal(claimed.job.sessionId, first.sessionId);
  assert.equal(claimed.job.sentAt, first.deadline);
  assert.deepEqual(publicInactivityStatus(claimed.job), {
    status: 'sent', sessionId: first.sessionId, deadline: first.deadline, sentAt: first.deadline, locale: 'en'
  });
  const secondTick = claimDueInactivityReminder(claimed.reminders, first.deadline);
  assert.equal(secondTick.job, null);
});

test('builds fixed localized copy without user input and recognizes secure origins', () => {
  assert.deepEqual(buildInactivityPushPayload('en'), {
    kind: 'active-inactivity', tag: 'active-inactivity',
    title: 'Workout inactivity reminder', body: 'It has been 15 minutes since your last workout record edit.'
  });
  assert.deepEqual(buildInactivityPushPayload('es'), {
    kind: 'active-inactivity', tag: 'active-inactivity',
    title: 'Recordatorio de inactividad del entrenamiento',
    body: 'Han pasado 15 minutos desde la última edición de un registro del entrenamiento.'
  });
  assert.equal(pushOriginCapable('https://gym.example.com'), true);
  assert.equal(pushOriginCapable('http://localhost:8080'), true);
  assert.equal(pushOriginCapable('http://192.168.1.5:8080'), false);
});
