// Compose authored variant labels without modifying generated translations.
import { EXERCISE_NAMES_ES as GENERATED_NAMES, EXERCISE_ALIASES_ES as GENERATED_ALIASES } from './exercise-names.es.js'
import { POWERLIFTING_VARIANTS } from './powerlifting-variants-data.js'
export { EXERCISE_NAME_ANGLICISMS_ES, EXERCISE_NAME_COLLISIONS_ES, EXERCISE_NAME_LOW_CONFIDENCE_ES } from './exercise-names.es.js'
export const EXERCISE_NAMES_ES = Object.freeze({ ...GENERATED_NAMES, ...Object.fromEntries(POWERLIFTING_VARIANTS.map(ex => [ex.id, ex.es])) })
export const EXERCISE_ALIASES_ES = GENERATED_ALIASES
