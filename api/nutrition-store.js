const tables = { foods: 'products', meals: 'meals', diary: 'diary', plan: 'plan', shopping: 'shopping', profile: 'profiles' }
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 256
const pos = v => Number.isFinite(v) && v > 0 && v <= 1e9
const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T12:00Z').toJSON()?.slice(0,10) === v
const metrics = v => v && typeof v === 'object' && ['energy','protein','carbs','fat'].every(k => v[k] == null || (Number.isFinite(v[k]) && v[k] >= 0))
const food = v => v && text(v.id) && text(v.name) && ['g','ml'].includes(v.unit) && metrics(v.values) &&
  (!v.barcode || /^\d{8,14}$/.test(v.barcode))
const meal = v => v && text(v.id) && text(v.name) && v.unit === 'serving' && pos(v.servings) && metrics(v.values) &&
  Array.isArray(v.ingredients) && v.ingredients.length > 0 && v.ingredients.length <= 200 && v.ingredients.every(p => p && food(p.item) && pos(p.amount))
const record = v => v && date(v.date) && ['Breakfast','Lunch','Snack','Dinner'].includes(v.slot) && pos(v.amount) && (food(v.item) || meal(v.item))
const validators = { foods: food, meals: meal, diary: record, plan: record,
  shopping: v => date(v.week) && text(v.name) && typeof v.checked === 'boolean',
  profile: v => Number.isInteger(v.age) && v.age >= 18 && v.age <= 100 && v.height >= 120 && v.height <= 240 &&
    ['male','female'].includes(v.sex) && ['sedentary','light','active','veryActive'].includes(v.activity) && ['lose','maintain','gain'].includes(v.goal) }
export function validNutritionChanges(changes) {
  return Array.isArray(changes) && changes.every(op => op && Object.hasOwn(tables,op.list) && text(op.id) &&
    (op.list !== 'profile' || op.id === 'profile') && (op.row === null || (op.row && typeof op.row === 'object' &&
      (op.list === 'profile' || op.row.id === op.id) && validators[op.list](op.row))))
}
export function nutritionStore(db) {
  const stmts = Object.fromEntries(Object.entries(tables).map(([list,name]) => {
    const table = 'nutrition_' + name
    return [list, {
      all: db.prepare('SELECT id, document FROM ' + table + ' WHERE user_id = ? ORDER BY rowid'),
      remove: db.prepare('DELETE FROM ' + table + ' WHERE user_id = ? AND id = ?'),
      save: db.prepare('INSERT INTO ' + table + '(user_id,id,document) VALUES(?,?,?) ON CONFLICT(user_id,id) DO UPDATE SET document=excluded.document'),
    }]
  }))
  const clearParts = db.prepare('DELETE FROM nutrition_ingredients WHERE user_id=? AND meal_id=?')
  const savePart = db.prepare('INSERT INTO nutrition_ingredients(user_id,meal_id,position,product_snapshot,amount) VALUES(?,?,?,?,?)')
  const parts = db.prepare('SELECT meal_id,product_snapshot,amount FROM nutrition_ingredients WHERE user_id=? ORDER BY meal_id,position')
  return {
    apply(user, changes) {
      for (const { list, id, row } of changes) {
        if (row === null) { stmts[list].remove.run(user,id); continue }
        if (list === 'meals') {
          const { ingredients, ...rest } = row
          stmts.meals.save.run(user,id,JSON.stringify(rest))
          clearParts.run(user,id)
          ingredients.forEach((p,i) => savePart.run(user,id,i,JSON.stringify(p.item),p.amount))
        } else stmts[list].save.run(user,id,JSON.stringify(row))
      }
    },
    read(user) {
      const data = {}
      for (const [list,stmt] of Object.entries(stmts)) {
        const rows = stmt.all.all(user).map(row => JSON.parse(row.document))
        data[list] = list === 'profile' ? rows[0] || null : rows
      }
      const meals = new Map(data.meals.map(m => { m.ingredients=[]; return [m.id,m] }))
      if (meals.size) for (const p of parts.all(user)) meals.get(p.meal_id).ingredients.push({ item: JSON.parse(p.product_snapshot), amount:p.amount })
      return data
    },
  }
}

