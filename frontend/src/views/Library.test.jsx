import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../store/useStore.js', () => ({
  useStore: selector => selector({ S: { customEx: [], workouts: [] } }),
}))
vi.mock('../sheets.jsx', () => ({
  exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn(), customExSheet: vi.fn(),
}))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))

import Library from './Library.jsx'

it('keeps the exercise library controls without offering a trainer catalog export', () => {
  const html = renderToStaticMarkup(<Library />)
  expect(html).toContain('Search…')
  expect(html).toContain('Filters')
  expect(html).toContain('Create your own exercise')
  expect(html).toContain('Plan')
  expect(html).not.toContain('Export catalog for your trainer')
})
