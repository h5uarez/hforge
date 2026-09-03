// Server-side push notification templates (Web Push payloads fired by api/server.js).
//
// English source strings are the keys — the same convention as the client's src/locales/
// packs (see frontend/src/lib/i18n.js). buildPushPayload whitelists the persisted user
// language to `es|en` at render time: an unvalidated stored value (state-validation.js
// does not check `lang`) never reaches a payload.
//
// Localization boundary: ONLY the template wrapper is translated. Every user-owned value
// (routine name, routine emoji, …) arrives through `vars` and is interpolated verbatim —
// never translated, transformed, case-changed, or catalog-looked-up. See the
// `documentedExclusions` in frontend/scripts/check-locales.mjs.

export const catalogs = {
  en: {
    'Rest over': 'Rest over',
    'Time for your next set.': 'Time for your next set.',
    '{emoji} {name} today': '{emoji} {name} today',
    "It's on your plan for today": "It's on your plan for today",
    'Workout planned today': 'Workout planned today',
    'Hforge': 'Hforge',
    'Test notification — this is how alerts look.': 'Test notification — this is how alerts look.',
  },
  es: {
    'Rest over': 'Descanso terminado',
    'Time for your next set.': 'Toca la siguiente serie.',
    '{emoji} {name} today': '{emoji} {name} hoy',
    "It's on your plan for today": "Está en tu plan para hoy",
    'Workout planned today': 'Entrenamiento planificado hoy',
    // Brand token — kept identical in both templates (documented exclusion).
    'Hforge': 'Hforge',
    'Test notification — this is how alerts look.': 'Notificación de prueba — así se ven los avisos.',
  },
};

// Static templates per push kind. `tag` mirrors the kind so the service worker keeps a
// stable per-kind notification identity.
const KINDS = {
  'rest-timer': { title: 'Rest over', body: 'Time for your next set.' },
  'day-reminder': { title: '{emoji} {name} today', body: "It's on your plan for today" },
  'day-reminder-generic': { title: 'Workout planned today', body: "It's on your plan for today" },
  'test': { title: 'Hforge', body: 'Test notification — this is how alerts look.' },
};

// Placeholder replacement is byte-for-byte: values are inserted exactly as given, never
// translated or transformed. Only the named placeholders in the template are touched.
const interpolate = (template, vars) =>
  Object.entries(vars).reduce((out, [key, value]) => out.replaceAll('{' + key + '}', String(value)), template);

export function buildPushPayload(rawLang, kind, vars = {}) {
  const lang = rawLang === 'es' ? 'es' : 'en';
  const spec = KINDS[kind];
  if (!spec) throw new Error('unknown push kind: ' + kind);
  const pack = catalogs[lang];
  return {
    title: interpolate(pack[spec.title] || spec.title, vars),
    body: interpolate(pack[spec.body] || spec.body, vars),
    tag: kind,
  };
}
