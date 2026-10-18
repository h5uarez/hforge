import { allExercises, exerciseName } from './exercises.js'

// Deliberately excludes workout data, weights, profile settings and coach/session notes.
export function buildTrainerCatalog(state, lang = 'en') {
  return {
    hforge_catalog: 1,
    planFormat: 'hforge_plan: 1',
    instructions: 'Use exercise IDs exactly. Variants have independent history. Define unavailable variants in plan.customEx with id, n, bp, baseId and variant; never invent an undefined exercise ID.',
    exercises: allExercises(state).map(ex => ({
      id: ex.id, n: exerciseName(ex, lang), canonicalName: ex.n, bp: ex.bp, eq: ex.eq,
      ...(ex.variant ? { baseId: ex.baseId, variant: { ...ex.variant } } : {}),
      ...(ex.custom ? { custom: true } : {}),
    })),
    // Include these definitions when a plan uses personal exercise IDs.
    customEx: (state.customEx || []).filter(ex => !ex.archived).map(ex => ({
      id: ex.id, n: ex.n, bp: ex.bp,
      ...(ex.variant ? { baseId: ex.baseId, variant: { ...ex.variant } } : {}),
    })),
  }
}
