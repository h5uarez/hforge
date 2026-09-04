import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/views/Plan.jsx'), 'utf8')
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('weekly schedule row layout contracts', () => {
  it('keeps weekday labels readable when routine names are long', () => {
    expect(source).toContain('className="item schedule-item"')
    expect(source).toContain('onClick={() => dayAssignSheet(d)}')
    expect(source).toContain('className="tag acc schedule-routine"')
    expect(source).toContain('<span className="schedule-routine-name">{r.name}</span>')
    expect(css).toContain('.schedule-item .grow{flex:1 1 auto;min-width:0}')
    expect(css).toContain('.schedule-item .tt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}')
    expect(css).toContain('.schedule-item .schedule-routine{flex:0 1 45%;min-width:0;max-width:45%;overflow:hidden}')
    expect(css).toContain('.schedule-item .schedule-routine-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
  })
})
