// Authored additions, kept outside the generated Hevy catalog. IDs are permanent.
const pause = (durationSec, position) => ({ kind: 'pause', durationSec, position })
const tempo = (eccentricSec, bottomPauseSec) => ({ kind: 'tempo', eccentricSec, bottomPauseSec, concentricSec: 'X', topPauseSec: 0 })
export const POWERLIFTING_VARIANTS = [
  { id: 'hf-bp-pause-1s', baseId: '79D0BB3A', n: 'Bench Press · 1-second chest pause', es: 'Press de banca · pausa 1 s en el pecho', variant: pause(1, 'chest') },
  { id: 'hf-bp-pause-2s', baseId: '79D0BB3A', n: 'Bench Press · 2-second chest pause', es: 'Press de banca · pausa 2 s en el pecho', variant: pause(2, 'chest') },
  { id: 'hf-bp-pause-3s', baseId: '79D0BB3A', n: 'Bench Press · 3-second chest pause', es: 'Press de banca · pausa 3 s en el pecho', variant: pause(3, 'chest') },
  { id: 'hf-bp-tempo-3100', baseId: '79D0BB3A', n: 'Bench Press · tempo 3-1-X-0', es: 'Press de banca · tempo 3-1-X-0', variant: tempo(3, 1) },
  { id: 'hf-bp-spoto-2s', baseId: '79D0BB3A', n: 'Spoto Press · 2-second pause above chest', es: 'Press Spoto · pausa 2 s sobre el pecho', variant: pause(2, 'above chest') },
  { id: 'hf-bp-pins-chest', baseId: '79D0BB3A', n: 'Pin Bench Press · chest height', es: 'Press de banca desde pines · altura del pecho', variant: { kind: 'pins', position: 'chest height' } },
  { id: 'hf-bp-larsen', baseId: '79D0BB3A', n: 'Larsen Press · legs extended without support', es: 'Press Larsen · piernas extendidas sin apoyo', variant: { kind: 'other', detail: 'legs extended without support' } },
  { id: 'hf-sq-pause-2s', baseId: 'D04AC939', n: 'Squat · 2-second bottom pause', es: 'Sentadilla · pausa 2 s abajo', variant: pause(2, 'bottom') },
  { id: 'hf-sq-pause-3s', baseId: 'D04AC939', n: 'Squat · 3-second bottom pause', es: 'Sentadilla · pausa 3 s abajo', variant: pause(3, 'bottom') },
  { id: 'hf-sq-tempo-3000', baseId: 'D04AC939', n: 'Squat · tempo 3-0-X-0', es: 'Sentadilla · tempo 3-0-X-0', variant: tempo(3, 0) },
  { id: 'hf-sq-pins-parallel', baseId: 'D04AC939', n: 'Pin Squat · parallel', es: 'Sentadilla desde pines · paralelo', variant: { kind: 'pins', position: 'parallel' } },
  { id: 'hf-dl-pause-1s', baseId: 'C6272009', n: 'Deadlift · 1-second pause below knee', es: 'Peso muerto · pausa 1 s bajo la rodilla', variant: pause(1, 'below knee') },
  { id: 'hf-dl-pause-2s', baseId: 'C6272009', n: 'Deadlift · 2-second pause below knee', es: 'Peso muerto · pausa 2 s bajo la rodilla', variant: pause(2, 'below knee') },
  { id: 'hf-dl-deficit-2cm', baseId: 'C6272009', n: 'Deficit Deadlift · 2 cm', es: 'Peso muerto con déficit · 2 cm', variant: { kind: 'deficit', heightCm: 2 } },
  { id: 'hf-dl-blocks-5cm', baseId: 'C6272009', n: 'Block Deadlift · bar raised 5 cm', es: 'Peso muerto desde bloques · barra elevada 5 cm', variant: { kind: 'blocks', heightCm: 5 } },
  { id: 'hf-dl-tempo-3000', baseId: 'C6272009', n: 'Deadlift · 3-second lowering', es: 'Peso muerto · descenso 3 s', variant: tempo(3, 0) },
  { id: 'hf-dl-sumo-pause-2s', baseId: 'D20D7BBE', n: 'Sumo Deadlift · 2-second pause below knee', es: 'Peso muerto sumo · pausa 2 s bajo la rodilla', variant: pause(2, 'below knee') },
]

export function buildPowerliftingVariants(catalog) {
  return POWERLIFTING_VARIANTS.map(({ es, ...definition }) => {
    const base = catalog.find(ex => ex.id === definition.baseId)
    if (!base) throw new Error(`Missing variant base: ${definition.baseId}`)
    return {
      id: definition.id, n: definition.n, baseId: base.id, variant: definition.variant,
      bp: base.bp, tg: base.tg, mg: base.mg, sm: base.sm, eq: base.eq,
      mode: base.mode, bodyweight: base.bodyweight, img: null, gif: null, video: null,
      st: [], desc: definition.n,
    }
  })
}
