import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import VariantFields, { conditionFromSelection, initialVariantSelection } from './VariantFields.jsx'
import { EXIDX } from '../lib/exercises.js'
import { normalizeVariant } from '../lib/exercise-variants.js'

describe('variant configuration fields', () => {
  it('leaves the standard exercise unchanged until the user opts in', () => {
    const value = initialVariantSelection(EXIDX['79D0BB3A'])
    expect(value.enabled).toBe(false)
    const html = renderToStaticMarkup(<VariantFields base={EXIDX['79D0BB3A']} state={{}} value={value} onChange={() => {}} />)
    expect(html).toContain('Variant / specific execution')
    expect(html).not.toContain('<select')
  })
  it('offers reusable curated variants and labels all condition inputs', () => {
    const value = { ...initialVariantSelection(EXIDX['79D0BB3A']), enabled: true, selected: 'new' }
    const html = renderToStaticMarkup(<VariantFields base={EXIDX['79D0BB3A']} state={{}} value={value} onChange={() => {}} />)
    expect(html).toContain('hf-bp-pause-2s')
    expect(html).toContain('Pause duration (seconds)')
    expect(html).toContain('Position / height reference')
    expect(html).toContain('Independent history')
    expect(normalizeVariant(conditionFromSelection({ ...value, position: 'chest' }))).toEqual({ kind: 'pause', durationSec: 2, position: 'chest' })
    expect(() => normalizeVariant(conditionFromSelection({ ...value, durationSec: '' }))).toThrow()
  })
})
