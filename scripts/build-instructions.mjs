#!/usr/bin/env node
// Regenerates the Spanish exercise instruction pack in frontend/src/instr/es.js
// from source exercise data. English stays inline only for legacy catalog rows that
// already carried independently verified English instructions. Hevy supplies Spanish
// instructions only, so this script never fabricates an English pack.
//
//   node scripts/build-instructions.mjs path-to-exercises.json
//
// A local JSON input path is required.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hevyAppId } from '../frontend/src/lib/hevy-compatibility.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'frontend', 'src', 'instr')

export const UNAVAILABLE_INSTRUCTION_SENTINELS = Object.freeze([
  'No hay instrucciones disponibles en la fuente.',
])

// These production rows predate the Hevy export and are not present in its active source set.
// Keep only the reviewed IDs here so a regeneration does not resurrect inactive instructions.
const LEGACY_SPANISH_INSTRUCTIONS = Object.freeze({
  '0007': [
    'Siéntate en la máquina de cable con la espalda recta y los pies apoyados en el suelo.',
    'Agarra las agarraderas con un agarre prono, un poco más separadas que el ancho de los hombros.',
    'Inclínate ligeramente hacia atrás y lleva las agarraderas hacia el pecho, juntando los omóplatos.',
    'Haz una pausa por un momento en el punto máximo del movimiento, luego suelta lentamente las agarraderas de vuelta a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '1436': [
    'Ponte de pie con los pies separados a la altura de los hombros, con los dedos de los pies ligeramente hacia afuera.',
    'Coloca la barra sobre la parte superior de la espalda, apoyándola en los trapecios.',
    'Activa el core y mantén el pecho elevado mientras comienzas a bajar en sentadilla, empujando las caderas hacia atrás y flexionando las rodillas.',
    'Baja hasta que los muslos queden paralelos al suelo, o tan abajo como puedas hacerlo cómodamente.',
    'Empuja con los talones para volver a ponerte de pie, extendiendo las caderas y las rodillas.',
    'Repite el número de repeticiones deseado.',
  ],
  '1435': [
    'Ponte de pie con los pies separados a la altura de los hombros y la barra apoyada sobre la parte superior de la espalda.',
    'Manteniendo el pecho elevado y el core activado, baja lentamente el cuerpo flexionando las rodillas y empujando las caderas hacia atrás.',
    'Continúa bajando hasta que los muslos queden paralelos al suelo o un poco por debajo.',
    'Haz una pausa breve y luego empuja con los talones para volver a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '0175': [
    'Sujeta una agarradera de cuerda a una polea alta y ponte de rodillas de espaldas a la máquina.',
    'Sujeta la agarradera de cuerda con ambas manos y colócala detrás de la cabeza, manteniendo los codos hacia afuera a los lados.',
    'Manteniendo las caderas inmóviles, flexiona la cintura y encoge el torso hacia los muslos.',
    'Haz una pausa por un momento en la parte inferior, luego regresa lentamente a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '0184': [
    'Sujeta una cuerda a una máquina de cable y coloca la polea en la posición más alta.',
    'Túmbate en un banco con la cabeza orientada hacia la máquina de cable.',
    'Sujeta la cuerda con ambas manos y extiende los brazos rectos por encima del pecho.',
    'Manteniendo los brazos rectos, baja lentamente la cuerda detrás de la cabeza manteniendo el control.',
    'Haz una pausa por un momento en la parte baja y luego sube lentamente la cuerda de vuelta a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '1323': [
    'Siéntate en la máquina de remo con los pies planos sobre los apoyapiés y las rodillas ligeramente flexionadas.',
    'Sujeta las cuerdas del cable con un agarre prono, con las palmas una frente a la otra.',
    'Mantén la espalda recta e inclínate ligeramente hacia adelante, manteniendo una ligera flexión en los codos.',
    'Jala las cuerdas del cable hacia el cuerpo, apretando los omóplatos entre sí.',
    'Haz una pausa por un momento en el punto más alto del movimiento, luego libera lentamente la tensión y regresa a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '0241': [
    'Coloca un accesorio en V en la máquina de cable en el ajuste más alto.',
    'Ponte de pie frente a la máquina de cable con los pies separados a la altura de los hombros.',
    'Agarra el accesorio en V con un agarre prono, con las palmas hacia abajo y las manos separadas a la altura de los hombros.',
    'Mantén los codos cerca de los costados y los brazos superiores quietos durante todo el ejercicio.',
    'Activa los tríceps y exhala mientras empujas el accesorio en V hacia abajo hasta que los brazos estén completamente extendidos.',
    'Haz una pausa breve en la parte baja del movimiento, apretando los tríceps.',
    'Inhala mientras regresas lentamente el accesorio en V a la posición inicial, manteniendo el control.',
    'Repite el número de repeticiones deseado.',
  ],
  '0311': [
    'Ponte de pie con los pies separados a la altura de los hombros, sosteniendo una mancuerna en cada mano con las palmas hacia el cuerpo.',
    'Mantén la espalda recta y activa el core.',
    'Levanta los brazos hacia los lados, manteniendo una ligera flexión en los codos, hasta que queden paralelos al suelo.',
    'Haz una pausa por un momento en la parte superior, luego baja lentamente los brazos de vuelta a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '0410': [
    'Ponte de pie con los pies separados a la altura de los hombros, sujetando una mancuerna en cada mano.',
    'Da un paso hacia adelante con un pie y coloca los pies de modo que el pie delantero quede plano en el suelo y el pie trasero quede elevado sobre un banco o escalón.',
    'Baja el cuerpo flexionando la rodilla y la cadera delanteras, manteniendo la rodilla trasera ligeramente flexionada y el talón trasero levantado del suelo.',
    'Continúa bajando hasta que el muslo delantero quede paralelo al suelo, luego empuja con el talón delantero para volver a la posición inicial.',
    'Repite el número de repeticiones deseado y luego cambia de pierna y repite.',
  ],
  '0582': [
    'Ajusta la máquina a tu cuerpo y selecciona el peso deseado.',
    'Arrodíllate en la máquina mirando hacia abajo, con las rodillas apoyadas en la almohadilla y los pies asegurados bajo las almohadillas para los pies.',
    'Sujeta las asas o los lados de la máquina para mayor estabilidad.',
    'Manteniendo quieta la parte superior del cuerpo, exhala y flexiona las piernas hacia los glúteos doblando las rodillas.',
    'Haz una pausa breve en la parte más alta del movimiento, contrayendo los isquiotibiales.',
    'Inhala y baja lentamente las piernas de vuelta a la posición inicial, extendiendo por completo las rodillas.',
    'Repite el número de repeticiones deseado.',
  ],
  '0584': [
    'Ajusta la altura del asiento y colócate en la máquina con la espalda apoyada en la almohadilla.',
    'Sujeta las asas con un agarre prono y mantén los brazos rectos.',
    'Exhala y levanta los brazos hacia los lados hasta que queden paralelos al suelo.',
    'Haz una pausa breve en lo alto, luego inhala y baja lentamente los brazos de vuelta a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '1349': [
    'Ajusta la altura del asiento y la posición de la placa para los pies en la máquina de palanca.',
    'Siéntate en la máquina con el pecho contra la almohadilla y los pies planos sobre la placa para los pies.',
    'Agarra las agarraderas con un agarre prono, un poco más separadas que el ancho de los hombros.',
    'Mantén la espalda recta y activa el core.',
    'Tira de las asas hacia el pecho, juntando los omóplatos.',
    'Haz una pausa breve en la parte alta del movimiento, luego suelta lentamente y extiende los brazos de vuelta a la posición inicial.',
    'Repite el número de repeticiones deseado.',
  ],
  '0739': [
    'Ajusta el asiento y la placa de la máquina de trineo a una posición cómoda.',
    'Siéntate en la máquina de trineo con la espalda contra el respaldo y los pies separados a la altura de los hombros sobre la placa.',
    'Sujeta las asas a los lados del asiento para mayor estabilidad.',
    'Empuja la placa alejándola de tu cuerpo extendiendo las piernas, manteniendo los talones sobre la placa.',
    'Continúa empujando hasta que las piernas estén casi completamente extendidas, pero sin bloquear las rodillas.',
    'Haz una pausa por un momento en la parte alta del movimiento, luego baja lentamente la placa de vuelta hacia tu cuerpo doblando las rodillas.',
    'Repite el número de repeticiones deseado.',
  ],
})

const cleanInstructionStep = value => String(value || '')
  .replaceAll('\\.', '.')
  .replace(/\s+/g, ' ')
  .trim()

export function isUnavailableInstruction(exercise) {
  const text = String(exercise?.instructions || '').trim()
  return exercise?.instruction_language === 'unavailable' || UNAVAILABLE_INSTRUCTION_SENTINELS.includes(text)
}

/** Parse Hevy's one numbered Spanish string without exposing numbering/escape residue in the UI. */
export function parseInstructionSteps(exerciseOrText) {
  const exercise = typeof exerciseOrText === 'object' ? exerciseOrText : { instructions: exerciseOrText }
  if (isUnavailableInstruction(exercise)) return []
  const lines = String(exercise.instructions || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const steps = []
  for (const line of lines) {
    const match = line.match(/^\d+\s*\\?\.\s*(.+)$/)
    if (!match) throw new Error(`Malformed numbered instruction for ${exercise.id || 'exercise'}: ${line}`)
    const step = cleanInstructionStep(match[1])
    if (!step) throw new Error(`Empty instruction step for ${exercise.id || 'exercise'}`)
    steps.push(step)
  }
  return steps
}

export function buildSpanishInstructionPack(exercises) {
  const pack = Object.fromEntries(Object.entries(LEGACY_SPANISH_INSTRUCTIONS).map(([id, steps]) => [id, [...steps]]))
  for (const ex of exercises) {
    const steps = parseInstructionSteps(ex)
    if (steps.length) pack[hevyAppId(ex.id)] = steps
  }
  return pack
}

export function writeSpanishInstructionPack(exercises, destination = join(outDir, 'es.js')) {
  mkdirSync(dirname(destination), { recursive: true })
  const pack = buildSpanishInstructionPack(exercises)
  writeFileSync(destination, '// generated by scripts/build-instructions.mjs — do not edit\nexport default ' + JSON.stringify(pack) + '\n')
  return pack
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const input = process.argv[2]
  if (!input) {
    console.error('Usage: node scripts/build-instructions.mjs <path-to-exercises.json>')
    process.exit(1)
  }
  const data = JSON.parse(readFileSync(input, 'utf8'))
  const exercises = Array.isArray(data) ? data : data.exercises
  if (!Array.isArray(exercises)) throw new Error('Input must be an array or an object with an exercises array')
  const pack = writeSpanishInstructionPack(exercises)
  console.log(`${join(outDir, 'es.js')}: ${Object.keys(pack).length} exercises`)
}
