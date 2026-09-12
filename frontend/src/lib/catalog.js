import { EXDB as LEGACY_EXDB } from './exercises-data.js'
import { HEVY_EXDB, HEVY_CATALOG_META } from './hevy-exercises-data.js'
import { HEVY_COMPATIBILITY, HEVY_COMPATIBILITY_POLICY } from './hevy-compatibility.js'

// The legacy catalog is ordered first so existing library visual/layout behavior remains stable.
// A mapped Hevy row replaces only the matching legacy ID; genuinely new rows keep their Hevy ID.
// Unmapped legacy rows remain readable rather than being silently merged with a merely similar
// Hevy template. This is the runtime counterpart of HEVY_COMPATIBILITY's review boundary.
const hevyByAppId = new Map(HEVY_EXDB.map(ex => [ex.id, ex]))
const legacyIds = new Set(LEGACY_EXDB.map(ex => ex.id))

const mergeReviewedRow = legacy => {
  const imported = hevyByAppId.get(legacy.id)
  if (!imported) return legacy
  return {
    ...legacy,
    ...imported,
    id: legacy.id,
    // Keep the old animation as a fallback for production rows while preferring the Hevy MP4.
    gif: legacy.gif || null,
    // New Hevy rows have no fabricated English instructions; legacy English remains valid here.
    st: Array.isArray(legacy.st) && legacy.st.length ? legacy.st : imported.st,
  }
}

export const EXDB = [
  ...LEGACY_EXDB.map(mergeReviewedRow),
  ...HEVY_EXDB.filter(ex => !legacyIds.has(ex.id)),
]

export { HEVY_EXDB, HEVY_CATALOG_META, HEVY_COMPATIBILITY, HEVY_COMPATIBILITY_POLICY, LEGACY_EXDB }
