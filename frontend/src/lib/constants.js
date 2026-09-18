// Central storage keys and timing tunables — single source of truth.
//
// Every value here intentionally matches the literal it replaced, so behavior
// is byte-identical; only the spelling changed. Two deliberate exceptions keep
// their own copies and must NOT import from here:
//   · frontend/index.html pre-paint script (runs before any module loads; the
//     drift guard in accessibility.test.js locks it to format.js/App.jsx).
//   · Service worker caches (public/sw.js has no module access to src/).
export const STORAGE_STATE_KEY = 'gym_state_v1'
export const STORAGE_LAST_VALID_KEY = 'gym_state_last_valid_v1'
export const STORAGE_LANG_KEY = 'gym_lang_v1'
export const STORAGE_USER_KEY = 'gym_user'
export const STORAGE_GUEST_KEY = 'gym_guest'
export const STORAGE_DIRTY_KEY = 'gym_dirty'

// Debounce / delay windows (ms). Renamed on import site, values unchanged.
export const PUSH_DEBOUNCE_MS = 1500
export const NATIVE_PERSIST_DEBOUNCE_MS = 800
export const LOGIN_FOCUS_DELAY_MS = 250
export const LOCALE_PACK_TIMEOUT_MS = 4000

// Shared scale base: percent math in components/ui.jsx (Stepper/Slider) and
// the weekday reminder notification id offset in lib/mobile.js both anchor on 100.
export const BASE_100 = 100
