// Server push catalog: Spanish rendering per kind, English fallback, and the
// localization boundary — user data flows through `vars` byte-identical in every
// language, never translated or transformed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPushPayload, catalogs } from './push-catalog.js';

test('renders Spanish payloads for every push kind under es', () => {
  assert.deepEqual(buildPushPayload('es', 'rest-timer'), {
    title: 'Descanso terminado', body: 'Toca la siguiente serie.', tag: 'rest-timer'
  });
  assert.deepEqual(buildPushPayload('es', 'day-reminder', { emoji: '🏋️', name: 'Push Day' }), {
    title: '🏋️ Push Day hoy', body: 'Está en tu plan para hoy', tag: 'day-reminder'
  });
  assert.deepEqual(buildPushPayload('es', 'day-reminder-generic'), {
    title: 'Entrenamiento planificado hoy', body: 'Está en tu plan para hoy', tag: 'day-reminder-generic'
  });
  assert.deepEqual(buildPushPayload('es', 'test'), {
    title: 'Hforge', body: 'Notificación de prueba — así se ven los avisos.', tag: 'test'
  });
});

test('falls back to English for en, absent, and unsupported languages', () => {
  assert.equal(buildPushPayload('en', 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload(undefined, 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload(null, 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload('', 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload('fr', 'rest-timer').title, 'Rest over');
  // Exact-match whitelist: an unvalidated persisted value must never reach a payload.
  assert.equal(buildPushPayload('ES', 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload('es-ES', 'rest-timer').title, 'Rest over');
  assert.equal(buildPushPayload('garbage', 'rest-timer').title, 'Rest over');
});

test('interpolates user data verbatim — byte-identical across languages', () => {
  const vars = { emoji: '🏋️', name: 'Núñez — Råðhús & Sörën' };
  const es = buildPushPayload('es', 'day-reminder', vars);
  const en = buildPushPayload('en', 'day-reminder', vars);
  assert.ok(es.title.includes(vars.name), 'Spanish title keeps the routine name');
  assert.ok(en.title.includes(vars.name), 'English title keeps the routine name');
  assert.ok(es.title.includes(vars.emoji), 'Spanish title keeps the routine emoji');
  // The name bytes inside the two titles are identical — only the wrapper differs.
  assert.equal(es.title.slice(es.title.indexOf(vars.name), es.title.indexOf(vars.name) + vars.name.length), vars.name);
  assert.equal(es.title.slice(es.title.indexOf(vars.name), es.title.indexOf(vars.name) + vars.name.length),
    en.title.slice(en.title.indexOf(vars.name), en.title.indexOf(vars.name) + vars.name.length));
  assert.notEqual(es.title, en.title, 'the localized wrapper differs from English');
});

test('interpolates the call-site-provided emoji verbatim', () => {
  // The server call site supplies the default (routine.emoji || '🏋️') — the catalog
  // only interpolates what it is given, byte for byte.
  const payload = buildPushPayload('es', 'day-reminder', { emoji: '🏋️', name: 'Halterofilia' });
  assert.equal(payload.title, '🏋️ Halterofilia hoy');
});

test('rejects unknown push kinds loudly', () => {
  assert.throws(() => buildPushPayload('es', 'bogus-kind'), /unknown push kind/);
});

test('keeps en and es catalogs in parity (same template keys)', () => {
  assert.deepEqual(Object.keys(catalogs.es).sort(), Object.keys(catalogs.en).sort());
  assert.ok(Object.keys(catalogs.en).length >= 6, 'catalog covers all push kinds');
});