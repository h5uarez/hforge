import { isoOf } from './format.js'

export const nutrients = ['energy', 'protein', 'carbs', 'fat']
export const nutrientNames = { energy: 'Energy', protein: 'Protein', carbs: 'Carbohydrates', fat: 'Fat' }
export const slots = ['Breakfast', 'Lunch', 'Snack', 'Dinner']
export const emptyNutrition = () => ({ foods: [], meals: [], diary: [], plan: [], shopping: [], profile: null })
export const positive = n => Number.isFinite(n) && n > 0
export function decimal(raw) {
  const text = String(raw ?? '').trim().replace(',', '.')
  return /^\d+(?:\.\d*)?$/.test(text) && Number.isFinite(Number(text)) ? Number(text) : null
}
export function shiftDay(iso, days) {
  const date = new Date(iso + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return isoOf(date)
}
export function weekStart(iso) {
  return shiftDay(iso, -((new Date(iso + 'T12:00:00').getDay() + 6) % 7))
}
export function totals(rows) {
  return Object.fromEntries(nutrients.map(key => {
    let value = 0, known = 0
    for (const { item, amount } of rows) {
      const n = item.values[key]
      if (Number.isFinite(n)) { value += n * amount / (item.unit === 'serving' ? 1 : 100); known++ }
    }
    return [key, { value: rows.length && !known ? null : value, partial: known < rows.length }]
  }))
}
export function mealItem(id, name, servings, ingredients) {
  const summary = totals(ingredients)
  return {
    id, name, unit: 'serving', servings, ingredients,
    values: Object.fromEntries(nutrients.map(k => [k, summary[k].partial ? null : summary[k].value / servings])),
  }
}
export function shoppingList(plan, monday) {
  const result = new Map()
  for (const row of plan.filter(p => p.date >= monday && p.date < shiftDay(monday, 7))) {
    const parts = row.item.unit === 'serving' ? row.item.ingredients : [{ item: row.item, amount: 1 }]
    for (const part of parts) {
      const { id, name, unit } = part.item
      const key = id + '/' + unit
      const entry = result.get(key) || { key, name, unit, amount: 0 }
      entry.amount += part.amount * row.amount / (row.item.servings || 1)
      result.set(key, entry)
    }
  }
  return [...result.values()].sort((a,b) => a.name.localeCompare(b.name))
}
export const activityFactors = { sedentary: 1.4, light: 1.6, active: 1.8, veryActive: 2 }
function profileOK(profile) {
  if (!profile) return false
  const { age, height, sex, activity, goal } = profile
  return Number.isInteger(age) && age >= 18 && age <= 100 && Number.isFinite(height) && height >= 120 && height <= 240 &&
    ['male','female'].includes(sex) && Object.hasOwn(activityFactors,activity) && ['lose','maintain','gain'].includes(goal)
}
export function energyGoal(profile, weight, unit) {
  if (!profileOK(profile) || !positive(weight)) return null
  const { age, height, sex, activity, goal } = profile
  const kg = unit === 'lb' ? weight * 0.45359237 : weight
  const resting = 10 * kg + 6.25 * height - 5 * age + (sex === 'male' ? 5 : -161)
  const maintenance = Math.round(resting * activityFactors[activity])
  const target = Math.round(maintenance * ({ lose: 0.90, maintain: 1, gain: 1.10 }[goal]))
  return maintenance > 0 && target >= 1000 ? { maintenance, target } : null
}

const isText = v => typeof v === 'string' && v.trim().length > 0
const foodOK = v => v && isText(v.id) && isText(v.name) && ['g','ml'].includes(v.unit) &&
  v.values && nutrients.every(k => v.values[k] == null || (Number.isFinite(v.values[k]) && v.values[k] >= 0))
const mealOK = v => v && isText(v.id) && isText(v.name) && v.unit === 'serving' && positive(v.servings) &&
  Array.isArray(v.ingredients) && v.ingredients.length && v.ingredients.every(p => p && foodOK(p.item) && positive(p.amount)) &&
  v.values && nutrients.every(k => v.values[k] == null || (Number.isFinite(v.values[k]) && v.values[k] >= 0))
const dateOK = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d))
const recordOK = v => v && isText(v.id) && dateOK(v.date) && slots.includes(v.slot) && positive(v.amount) && (foodOK(v.item) || mealOK(v.item))
const checks = { foods: foodOK, meals: mealOK, diary: recordOK, plan: recordOK,
  shopping: v => v && isText(v.id) && dateOK(v.week) && isText(v.name) && typeof v.checked === 'boolean' }
export function normalizeNutrition(raw) {
  const data = emptyNutrition()
  for (const [k, valid] of Object.entries(checks)) {
    if (Array.isArray(raw?.[k])) data[k] = raw[k].filter(valid)
  }
  if (profileOK(raw?.profile)) data.profile = raw.profile
  return data
}
export function mergeNutrition(current, incoming) {
  const merged = normalizeNutrition(current), source = normalizeNutrition(incoming)
  for (const k of Object.keys(checks)) {
    const ids = new Set(merged[k].map(row => row.id))
    for (const row of source[k]) {
      if (!ids.has(row.id)) { merged[k].push(row); ids.add(row.id) }
    }
  }
  merged.profile ||= source.profile
  return merged
}
export const hasNutrition = n => n && (n.profile || Object.keys(checks).some(key => n[key]?.length))

