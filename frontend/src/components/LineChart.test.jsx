import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LineChart, { sanitizeChartPoints } from './LineChart.jsx'

describe('LineChart point sanitization', () => {
  it('keeps finite chart points and removes invalid geometry before rendering', () => {
    const valid = { t: 1000, y: 80, m: 0.5 }

    expect(sanitizeChartPoints([
      valid,
      { t: undefined, y: 90 },
      { t: 2000, y: NaN },
      { t: 3000, y: 100, m: Infinity },
      null,
    ])).toEqual([
      valid,
      { t: 3000, y: 100, m: null },
    ])
    expect(sanitizeChartPoints(undefined)).toEqual([])
  })

  it('does not render invalid SVG coordinates when a caller supplies a bad point', () => {
    const markup = renderToStaticMarkup(<LineChart points={[{ t: undefined, y: 90 }, { t: 1000, y: 80 }]} />)

    expect(markup).not.toMatch(/NaN|undefined/)
  })
})
