const lists = ['foods', 'meals', 'diary', 'plan', 'shopping']

// Queue the latest edit per record. The token lets a slow acknowledgement leave
// a more recent edit to the same record in the outbox.
export function queueNutrition(before, after, pending, token) {
  const ops = new Map((pending || []).map(op => [JSON.stringify([op.list, op.id]), op]))
  const add = (list, id, row) => ops.set(JSON.stringify([list,id]), { list, id, row, token })
  for (const list of lists) {
    const old = new Map((before?.[list] || []).map(row => [row.id, row]))
    for (const row of after?.[list] || []) {
      if (JSON.stringify(old.get(row.id)) !== JSON.stringify(row)) add(list,row.id,row)
      old.delete(row.id)
    }
    for (const id of old.keys()) add(list,id,null)
  }
  if (JSON.stringify(before?.profile ?? null) !== JSON.stringify(after?.profile ?? null))
    add('profile','profile',after?.profile ?? null)
  return [...ops.values()]
}
export function overlayNutrition(data, ops) {
  const next = { ...data }
  for (const op of ops || []) {
    if (op.list === 'profile') { next.profile = op.row; continue }
    if (!lists.includes(op.list)) continue
    const list = [...(next[op.list] || [])], index = list.findIndex(r => r.id === op.id)
    if (op.row && index < 0) list.push(op.row)
    else if (index >= 0) list.splice(index,1,...(op.row ? [op.row] : []))
    next[op.list] = list
  }
  return next
}

