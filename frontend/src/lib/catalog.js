import { EXDB as LEGACY_EXDB } from './exercises-data.js'
import { HEVY_EXDB, HEVY_CATALOG_META } from './hevy-exercises-data.js'
import { HEVY_COMPATIBILITY, HEVY_COMPATIBILITY_POLICY } from './hevy-compatibility.js'
import { HEVY_TO_LEGACY, LEGACY_TO_HEVY } from './exercise-ids.js'

// The legacy catalog is ordered first so existing library visual/layout behavior remains stable.
// A reviewed Hevy row replaces the matching legacy row, but the visible identity is now the Hevy
// ID. Unmapped legacy rows remain readable rather than being silently merged with a similar
// template. This is the runtime counterpart of HEVY_COMPATIBILITY's review boundary.
const hevyById = new Map(HEVY_EXDB.map(ex => [ex.hevyId, ex]))

const mergeReviewedRow = legacy => {
  const hevyId = LEGACY_TO_HEVY[legacy.id]
  const imported = hevyById.get(hevyId)
  if (!imported) return legacy
  return {
    ...legacy,
    ...imported,
    id: hevyId,
    // Keep the old animation as a fallback for production rows while preferring the Hevy MP4.
    gif: legacy.gif || null,
    // New Hevy rows have no fabricated English instructions; legacy English remains valid here.
    st: Array.isArray(legacy.st) && legacy.st.length ? legacy.st : imported.st,
  }
}

export const EXDB = [
  ...LEGACY_EXDB.map(mergeReviewedRow),
  ...HEVY_EXDB.filter(ex => !Object.hasOwn(HEVY_TO_LEGACY, ex.hevyId)),
]

export { HEVY_EXDB, HEVY_CATALOG_META, HEVY_COMPATIBILITY, HEVY_COMPATIBILITY_POLICY, LEGACY_EXDB }
