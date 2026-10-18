import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/views/Settings.jsx'), 'utf8')

describe('Settings data tools', () => {
  it('removes third-party import and its file picker', () => {
    expect(source).not.toContain('Import from another app')
    expect(source).not.toContain('importFromApp')
    expect(source).not.toContain('importRef')
    expect(source).not.toContain('.csv,.xml')
  })

  it('keeps JSON backup import and export available', () => {
    expect(source).toContain("title={t('Import backup')}")
    expect(source).toContain('onChange={doImport}')
    expect(source).toContain('mergeBackupImport(s, data)')
    expect(source).toContain('accept=".json,application/json"')
    expect(source).toContain("title={t('Export backup (JSON)')}")
    expect(source).toContain('onClick={doExport}')
  })
})
