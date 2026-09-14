import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/components/Modals.jsx'), 'utf8')

describe('sheet focus restoration contracts', () => {
  it('restores the delayed opener focus without moving the viewport', () => {
    expect(source).toContain('setTimeout(() => target.focus({ preventScroll: true }), 0)')
    expect(source).not.toContain('setTimeout(() => target.focus(), 0)')
  })

  it('keeps cleanup focus restoration from moving the viewport', () => {
    expect(source).toContain('returnFocus.current.focus({ preventScroll: true })')
    expect(source).not.toContain('returnFocus.current.focus()')
  })
})
