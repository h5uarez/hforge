const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0 }

export const p2 = n => String(n).padStart(2, '0')
export const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

export const hm = (h, mi) => (h === undefined ? null : (parseInt(h, 10) || 0) * 3600000 + (parseInt(mi, 10) || 0) * 60000)

/** "2020-12-30 18:51:52" · "2024-03-07" · "22 Dec 2025, 08:00" · "07/03/2024" -> { d, t } */
export function parseWhen(s) {
  const v = String(s || '').trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/)
  if (m) return { d: `${m[1]}-${p2(m[2])}-${p2(m[3])}`, t: hm(m[4], m[5]) }
  m = v.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[2].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[2].toLowerCase()])}-${p2(m[1])}`, t: hm(m[4], m[5]) }
  m = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2}))?/)
  if (m && MON[m[1].toLowerCase()]) return { d: `${m[3]}-${p2(MON[m[1].toLowerCase()])}-${p2(m[2])}`, t: hm(m[4], m[5]) }
  // Day-first when ambiguous: FitNotes/Strong/Hevy all write unambiguous dates, so a
  // bare numeric one came through a spreadsheet, and those are usually European.
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[, ]+(\d{1,2}):(\d{2}))?/)
  if (m) {
    const [, a, b, y] = m
    const day = +a > 12 ? a : +b > 12 ? b : a
    const mon = day === a ? b : a
    return { d: `${y}-${p2(mon)}-${p2(day)}`, t: hm(m[4], m[5]) }
  }
  return null
}

/** "HH:MM:SS" · "MM:SS" · "90" -> minutes */
export function toMinutes(v) {
  const s = String(v ?? '').trim()
  if (!s) return 0
  if (s.includes(':')) {
    const p = s.split(':').map(x => parseInt(x, 10) || 0)
    const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
    return Math.round(sec / 60 * 10) / 10
  }
  const m = s.match(/(\d+)\s*h/i), mm = s.match(/(\d+)\s*m/i)      // Strong's "2h 38m"
  if (m || mm) return (m ? +m[1] * 60 : 0) + (mm ? +mm[1] : 0)
  return Math.round(num(s) * 10) / 10
}

export const KM = { m: 0.001, km: 1, cm: 0.00001, in: 0.0000254, ft: 0.0003048, yd: 0.0009144, mi: 1.609344 }
export const toKm = (v, unit) => num(v) * (KM[String(unit || 'km').toLowerCase().trim()] ?? 1)
