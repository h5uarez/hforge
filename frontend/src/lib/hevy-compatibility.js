// Reviewed compatibility boundary for the Hevy catalog import.
//
// Hevy template IDs are eight-character hex strings. Hforge already has numeric IDs in
// persisted routines, workouts, PRs, exWeights, active sessions, imports, and plan shares.
// Only the explicit entries below may reuse one of those numeric IDs. The importer never
// guesses from names, muscles, equipment, or fuzzy similarity: an unmapped Hevy template keeps
// its Hevy ID, and a legacy Hforge row remains visible when its equivalence is not certain.
//
// 2330 is deliberately absent. It is a retired Hforge alias for 0198 and must not be resurrected.
export const HEVY_COMPATIBILITY_POLICY = Object.freeze({
  automaticSemanticMapping: false,
  preserveLegacyIds: true,
  retiredIds: Object.freeze(['2330']),
})

export const HEVY_COMPATIBILITY = Object.freeze({
  // Exact or reviewed-equivalent production records.
  '79D0BB3A': Object.freeze({ appId: '0025', reason: 'Bench Press (Barbell) preserves the existing barbell bench press identity.' }),
  '55E6546F': Object.freeze({ appId: '0027', reason: 'Bent Over Row (Barbell) preserves the existing barbell bent-over row identity.' }),
  'A5AC6449': Object.freeze({ appId: '0031', reason: 'Bicep Curl (Barbell) preserves the existing barbell curl identity.' }),
  'C6272009': Object.freeze({ appId: '0032', reason: 'Deadlift (Barbell) preserves the existing barbell deadlift identity.' }),
  '1283BBA6': Object.freeze({ appId: '0043', reason: 'Full Squat preserves the existing full barbell squat identity.' }),
  '50DFDFAB': Object.freeze({ appId: '0047', reason: 'Incline Bench Press (Barbell) preserves the existing incline barbell bench press identity.' }),
  '2B4B7310': Object.freeze({ appId: '0085', reason: 'Romanian Deadlift (Barbell) preserves the existing barbell Romanian deadlift identity.' }),
  'ADA8623C': Object.freeze({ appId: '0868', reason: 'Bicep Curl (Cable) preserves the existing cable curl identity.' }),
  'BE289E45': Object.freeze({ appId: '0178', reason: 'Lateral Raise (Cable) preserves the existing cable lateral raise identity.' }),
  '6A6C31A5': Object.freeze({ appId: '0198', reason: 'Lat Pulldown (Cable) is the reviewed canonical match for the existing cable pulldown.' }),
  '93A552C6': Object.freeze({ appId: '0201', reason: 'Triceps Pushdown preserves the existing generic cable pushdown identity.' }),
  '94B7239B': Object.freeze({ appId: '0200', reason: 'Triceps Rope Pushdown preserves the existing rope cable pushdown identity.' }),
  '9273BA17': Object.freeze({ appId: '0237', reason: 'Rope Straight Arm Pulldown preserves the existing rope straight-arm pulldown identity.' }),
  '6FCD7755': Object.freeze({ appId: '0251', reason: 'Chest Dip preserves the existing unassisted chest dip identity.' }),
  '7E3BC8B6': Object.freeze({ appId: '0313', reason: 'Hammer Curl (Dumbbell) preserves the existing dumbbell hammer curl identity.' }),
  '8BAB2735': Object.freeze({ appId: '0315', reason: 'Seated Incline Curl (Dumbbell) preserves the existing incline dumbbell curl identity.' }),
  '422B08F1': Object.freeze({ appId: '0334', reason: 'Lateral Raise (Dumbbell) preserves the existing dumbbell lateral raise identity.' }),
  '72CFFAD5': Object.freeze({ appId: '1459', reason: 'Romanian Deadlift (Dumbbell) preserves the existing dumbbell Romanian deadlift identity.' }),
  '6AC96645': Object.freeze({ appId: '0426', reason: 'Overhead Press (Dumbbell) preserves the existing standing dumbbell overhead press identity.' }),
  '75A4F6C4': Object.freeze({ appId: '0585', reason: 'Leg Extension (Machine) preserves the existing lever leg extension identity.' }),
  'B8127AD1': Object.freeze({ appId: '0586', reason: 'Lying Leg Curl (Machine) preserves the existing lever lying leg curl identity.' }),
  '91237BDD': Object.freeze({ appId: '2335', reason: 'Calf Press (Machine) preserves the existing seated calf press identity.' }),
  'EB43ADD4': Object.freeze({ appId: '1452', reason: 'Crunch (Machine) preserves the existing lever seated crunch identity.' }),
  'F4B4C6EE': Object.freeze({ appId: '0597', reason: 'Hip Abduction (Machine) preserves the existing seated machine hip abduction identity.' }),
  '8BEBFED6': Object.freeze({ appId: '0598', reason: 'Hip Adduction (Machine) preserves the existing seated machine hip adduction identity.' }),
  'D8281C62': Object.freeze({ appId: '0602', reason: 'Rear Delt Reverse Fly (Machine) preserves the existing seated reverse-fly identity.' }),
  '9237BAD1': Object.freeze({ appId: '0603', reason: 'Seated Shoulder Press (Machine) preserves the existing lever shoulder press identity.' }),
  'E05C2C38': Object.freeze({ appId: '0605', reason: 'Standing Calf Raise (Machine) preserves the existing lever standing calf raise identity.' }),
  '08A2974E': Object.freeze({ appId: '0606', reason: 'T Bar Row preserves the existing lever T-bar row identity.' }),
  '9F9C164B': Object.freeze({ appId: '1401', reason: 'Muscle Up preserves the existing bar muscle-up identity.' }),
  '1B2B1E7C': Object.freeze({ appId: '0652', reason: 'Pull Up preserves the existing pull-up identity.' }),
  'AC1BB830': Object.freeze({ appId: '0684', reason: 'Running preserves the existing running exercise identity.' }),
  '3A6FA3D1': Object.freeze({ appId: '0757', reason: 'Incline Bench Press (Smith Machine) preserves the existing Smith incline bench identity.' }),
  '729237D1': Object.freeze({ appId: '0841', reason: 'Pull Up (Weighted) preserves the existing weighted pull-up identity.' }),
  '6A8D3193': Object.freeze({ appId: '5214', reason: 'Chest Supported T Bar Row preserves the existing chest-supported T-bar row identity.' }),
  'D57C2EC7': Object.freeze({ appId: '5218', reason: 'Hip Thrust (Barbell) preserves the existing barbell hip-thrust identity.' }),
  '091737FA': Object.freeze({ appId: '5223', reason: 'Back Extension (Weighted Hyperextension) preserves the existing weighted back-extension identity.' }),
  'ACB2751D': Object.freeze({ appId: '5225', reason: 'Standing Cable Glute Kickbacks preserves the existing cable glute-kickback identity.' }),
})

// Stable search vocabulary from the last production catalog. This is separate from the new
// source-name map because mapped rows intentionally display Hevy's `name`, while old CSV/plan
// text must continue resolving to the preserved numeric ID.
export const LEGACY_EXERCISE_DISPLAY_ALIASES_ES = Object.freeze({
  '0025': 'Press de Banca con Barra', '0027': 'Remo Inclinado con Barra', '0031': 'Curl con Barra',
  '0032': 'Peso Muerto con Barra', '0043': 'Sentadilla Trasera Completa con Barra',
  '0047': 'Press de Banca Inclinado con Barra', '0085': 'Peso Muerto Rumano con Barra',
  '0868': 'Curl en Polea', '0178': 'Elevación Lateral en Polea', '0198': 'Jalón al Pecho (Cable)',
  '0201': 'Jalón de Tríceps en Polea', '0200': 'Jalón de Tríceps con Cuerda en Polea',
  '0237': 'Pullover de Pie con Cuerda en Polea', '0251': 'Fondos de Pecho',
  '0313': 'Curl Martillo con Mancuernas', '0315': 'Curl de Bíceps en Banco Inclinado con Mancuernas',
  '0334': 'Elevación Lateral con Mancuernas', '1459': 'Peso Muerto Rumano con Mancuernas',
  '0426': 'Press por Encima de la Cabeza de Pie con Mancuernas', '0585': 'Extensión de Piernas en Máquina',
  '0586': 'Curl Femoral Tumbado en Máquina', '2335': 'Prensa de Gemelos Sentado en Máquina de Palancas',
  '1452': 'Encogimientos Abdominales Sentado en Máquina de Palancas',
  '0597': 'Abducción de Cadera Sentado en Máquina de Palancas',
  '0598': 'Aducción de Cadera Sentado en Máquina de Palancas',
  '0602': 'Aperturas Inversas Sentado en Máquina de Palancas', '0603': 'Press de Hombros en Máquina',
  '0605': 'Elevación de Gemelos de Pie en Máquina', '0606': 'Remo con Barra T en Máquina de Palancas',
  '1401': 'Muscle-up en Barra', '0652': 'Dominadas', '0684': 'Carrera en Máquina',
  '0757': 'Press de Banca en Banco Inclinado en Máquina Smith', '0841': 'Dominadas Lastradas',
  '5214': 'remo en T con pecho apoyado', '5218': 'hip thrust', '5223': 'hiperextensión lastrada',
  '5225': 'patada de glúteo',
})

export const hevyAppId = hevyId => HEVY_COMPATIBILITY[hevyId]?.appId || hevyId
