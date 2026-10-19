import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Media, { Thumb } from './Media.jsx'
import { EXIDX, registerCustom, imgSrc, videoSrc } from '../lib/exercises.js'

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: {}, update: vi.fn() }) }))
afterEach(() => registerCustom([]))

it('renders base reference media for built-in and personal variants without changing identity', () => {
  const base = EXIDX['79D0BB3A']
  registerCustom([{ id: 'personal-pause', n: 'My pause', baseId: base.id, variant: { kind: 'pause', durationSec: 4, position: 'chest' } }])
  for (const ex of [EXIDX['hf-bp-pause-2s'], EXIDX['personal-pause']]) {
    const before = JSON.stringify(ex)
    const html = renderToStaticMarkup(<Media ex={ex} />)
    expect(html).toContain(videoSrc(base))
    expect(html).toContain('Base exercise reference — the variant condition is not demonstrated.')
    expect(renderToStaticMarkup(<Thumb ex={ex} />)).toContain(imgSrc(base))
    expect(JSON.stringify(ex)).toBe(before)
  }
})

it('keeps ordinary media, own variant media and custom no-media behavior', () => {
  const base = EXIDX['79D0BB3A']
  const normal = renderToStaticMarkup(<Media ex={base} />)
  expect(normal).toContain(videoSrc(base))
  expect(normal).not.toContain('Base exercise reference')
  const own = { ...EXIDX['hf-bp-pause-2s'], video: 'own.mp4', img: 'own.jpg' }
  const html = renderToStaticMarkup(<Media ex={own} />)
  expect(html).toContain('video/own.mp4')
  expect(html).not.toContain('Base exercise reference')
  expect(renderToStaticMarkup(<Thumb ex={own} />)).toContain('img/own.jpg')
  expect(renderToStaticMarkup(<Media ex={{ id: 'custom', n: 'Custom' }} />)).toBe('')
  expect(renderToStaticMarkup(<Media ex={{ id: 'orphan', n: 'Orphan', baseId: 'missing', variant: {} }} />)).toBe('')
})
