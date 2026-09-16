import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  assertReleaseBump,
  assertVersionMetadata,
  classifyReleaseChange,
  compareVersions,
  getVersionMetadata,
  parseSemver,
  parseConventionalCommit,
  runVersionCheck,
} from './check-version.mjs'

const temporaryRoots = []

function fixtureRoot(version = '1.3.0') {
  const root = mkdtempSync(resolve(tmpdir(), 'hforge-version-test-'))
  temporaryRoots.push(root)
  mkdirSync(resolve(root, 'frontend', 'public'), { recursive: true })
  writeFileSync(resolve(root, 'frontend', 'package.json'), JSON.stringify({ name: 'fixture', version }, null, 2) + '\n')
  writeFileSync(resolve(root, 'frontend', 'package-lock.json'), JSON.stringify({
    name: 'fixture', version, lockfileVersion: 3, packages: { '': { name: 'fixture', version } },
  }, null, 2) + '\n')
  writeFileSync(resolve(root, 'frontend', 'public', 'version.json'), JSON.stringify({ version }) + '\n')
  writeFileSync(resolve(root, 'frontend', 'public', 'sw.js'), `const SW_VERSION = 'hforge-pwa-v${version}'\n`)
  return root
}

function git(root, ...args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

function setFixtureVersion(root, version) {
  for (const path of ['frontend/package.json', 'frontend/package-lock.json']) {
    const file = resolve(root, path)
    const json = JSON.parse(readFileSync(file, 'utf8'))
    json.version = version
    if (json.packages?.['']) json.packages[''].version = version
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  }
  writeFileSync(resolve(root, 'frontend', 'public', 'version.json'), JSON.stringify({ version }) + '\n')
  writeFileSync(resolve(root, 'frontend', 'public', 'sw.js'), `const SW_VERSION = 'hforge-pwa-v${version}'\n`)
}

afterEach(() => {
  while (temporaryRoots.length) rmSync(temporaryRoots.pop(), { recursive: true, force: true })
})

describe('SemVer validation and ordering', () => {
  it('accepts strict SemVer and rejects malformed values', () => {
    assert.equal(parseSemver('1.2.3')?.major, '1')
    assert.equal(parseSemver('1.2'), null)
    assert.equal(parseSemver('01.2.3'), null)
    assert.equal(parseSemver('1.2.3-01'), null)
    assert.equal(parseSemver('1.2.3-0')?.prerelease[0], '0')
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1)
    assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
    assert.equal(compareVersions('1.2.3-alpha', '1.2.3'), -1)
    assert.equal(parseSemver('9007199254740993.0.0')?.major, '9007199254740993')
    assert.equal(compareVersions('9007199254740994.0.0', '9007199254740993.0.0'), 1)
    assert.equal(compareVersions('1.9007199254740994.0', '1.9007199254740993.0'), 1)
    assert.equal(compareVersions('1.2.9007199254740994', '1.2.9007199254740993'), 1)
    assert.equal(compareVersions('1.2.3-9007199254740994', '1.2.3-9007199254740993'), 1)
    assert.throws(() => compareVersions('invalid', '1.2.3'), /Invalid SemVer/)
  })
})

describe('metadata consistency', () => {
  it('accepts package, lock, runtime, and service-worker metadata when synchronized', () => {
    const root = fixtureRoot()
    assert.equal(assertVersionMetadata(root).canonicalVersion, '1.3.0')
  })

  it('reports the canonical source and every mismatched copy', () => {
    const root = fixtureRoot()
    writeFileSync(resolve(root, 'frontend', 'public', 'version.json'), '{"version":"1.2.4"}\n')
    const metadata = getVersionMetadata(root)
    assert.match(metadata.errors.join('\n'), /frontend\/public\/version\.json is "1\.2\.4" but frontend\/package\.json is 1\.3\.0/)
    assert.throws(() => assertVersionMetadata(root), /node scripts\/sync-version\.mjs/)
  })
})

describe('release classification', () => {
  it('does not require a bump for docs, tests, CI, or the checker itself', () => {
    const paths = ['README.md', 'docs/release.md', 'frontend/src/lib/foo.test.js', '.github/workflows/ci.yml', 'scripts/check-version.mjs', 'scripts/sync-version.mjs']
    const result = classifyReleaseChange(paths, [{ subject: 'feat!: explain the release process', body: '' }])
    assert.equal(result.requiredLevel, 'none')
  })

  it('maps breaking, feature, patch, and untyped release changes to the required level', () => {
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'feat!: replace the app shell', body: '' }]).requiredLevel, 'major')
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'feat: show the version', body: '' }]).requiredLevel, 'minor')
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'fix: keep the footer visible', body: '' }]).requiredLevel, 'patch')
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'refactor: simplify startup', body: '' }]).requiredLevel, 'patch')
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'update app shell', body: '' }]).requiredLevel, 'patch')
    assert.equal(classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'chore: dependency refresh', body: 'BREAKING CHANGE: update the API' }]).requiredLevel, 'major')
  })

  it('ignores breaking subjects from commits that only touch exempt paths', () => {
    const result = classifyReleaseChange(
      ['frontend/src/App.jsx', 'docs/release.md', 'frontend/src/lib/foo.test.js', '.github/workflows/ci.yml'],
      [
        { subject: 'feat: expose the app version', body: '', paths: ['frontend/src/App.jsx'] },
        {
          subject: 'feat!: explain the breaking release process',
          body: '',
          paths: ['docs/release.md', 'frontend/src/lib/foo.test.js', '.github/workflows/ci.yml'],
        },
      ],
    )
    assert.equal(result.requiredLevel, 'minor')
    assert.deepEqual(result.reasons, ['feat: expose the app version (feature)'])
  })

  it('recognizes conventional scopes and breaking footers', () => {
    assert.deepEqual(parseConventionalCommit('fix(pwa): refresh cache', ''), {
      subject: 'fix(pwa): refresh cache', type: 'fix', breaking: false,
    })
    assert.equal(parseConventionalCommit('refactor: update runtime', 'BREAKING CHANGE: new API').breaking, true)
  })
})

describe('release bump enforcement', () => {
  it('requires the classified bump and rejects unchanged or decreasing versions', () => {
    const minor = classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'feat: expose version', body: '' }])
    assert.equal(assertReleaseBump({ previousVersion: '1.2.4', currentVersion: '1.3.0', classification: minor }).actualLevel, 'minor')
    assert.throws(() => assertReleaseBump({ previousVersion: '1.2.4', currentVersion: '1.2.4', classification: minor }), /unchanged/)
    assert.throws(() => assertReleaseBump({ previousVersion: '1.2.4', currentVersion: '1.2.3', classification: minor }), /lower/)
    assert.throws(() => assertReleaseBump({ previousVersion: '1.2.4', currentVersion: '1.2.5', classification: minor }), /at least a minor/)
  })

  it('does not count a prerelease-only increase as a stable bump', () => {
    const patch = classifyReleaseChange(['frontend/src/App.jsx'], [{ subject: 'fix: update app behavior', body: '' }])
    assert.throws(
      () => assertReleaseBump({ previousVersion: '1.2.3-alpha.1', currentVersion: '1.2.3-alpha.2', classification: patch }),
      /only a prerelease bump/,
    )
    assert.equal(
      assertReleaseBump({ previousVersion: '1.2.3-alpha.1', currentVersion: '1.2.3', classification: patch }).actualLevel,
      'patch',
    )
  })

  it('allows unchanged versions for exempt-only changes', () => {
    const docs = classifyReleaseChange(['docs/release.md'], [{ subject: 'docs: explain versioning', body: '' }])
    assert.equal(assertReleaseBump({ previousVersion: '1.2.4', currentVersion: '1.2.4', classification: docs }).requiredLevel, 'none')
  })

  it('uses the Git base package version, paths, and commit subjects together', () => {
    const root = fixtureRoot('1.2.4')
    mkdirSync(resolve(root, 'frontend', 'src'), { recursive: true })
    writeFileSync(resolve(root, 'frontend', 'src', 'App.jsx'), 'export default function App() {}\n')
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'version-test@example.invalid')
    git(root, 'config', 'user.name', 'Version Test')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'chore: establish fixture')

    setFixtureVersion(root, '1.3.0')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'feat: expose the app version')

    const result = runVersionCheck({ rootDir: root, baseRef: 'HEAD~1' })
    assert.equal(result.previousVersion, '1.2.4')
    assert.equal(result.classification.requiredLevel, 'minor')
    assert.equal(result.comparison.actualLevel, 'minor')
    assert.deepEqual(result.classification.releaseRelevantPaths, [
      'frontend/package-lock.json', 'frontend/package.json', 'frontend/public/sw.js', 'frontend/public/version.json',
    ])
    assert.ok(result.changes.commits.every(commit => Array.isArray(commit.paths)))
    assert.deepEqual(result.changes.commits[0].paths, [
      'frontend/package-lock.json', 'frontend/package.json', 'frontend/public/sw.js', 'frontend/public/version.json',
    ])
  })

  it('parses multiple commits and ignores an exempt-only breaking commit', () => {
    const root = fixtureRoot('1.2.4')
    mkdirSync(resolve(root, 'frontend', 'src'), { recursive: true })
    writeFileSync(resolve(root, 'frontend', 'src', 'App.jsx'), 'export default 1\n')
    git(root, 'init', '-q')
    git(root, 'config', 'user.email', 'version-test@example.invalid')
    git(root, 'config', 'user.name', 'Version Test')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'chore: establish fixture')

    writeFileSync(resolve(root, 'frontend', 'src', 'App.jsx'), 'export default 2\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'fix: preserve source behavior')

    mkdirSync(resolve(root, 'docs'), { recursive: true })
    mkdirSync(resolve(root, 'frontend', 'src', 'lib'), { recursive: true })
    mkdirSync(resolve(root, '.github', 'workflows'), { recursive: true })
    writeFileSync(resolve(root, 'docs', 'release.md'), 'Release notes\n')
    writeFileSync(resolve(root, 'frontend', 'src', 'lib', 'release.test.js'), 'test\n')
    writeFileSync(resolve(root, '.github', 'workflows', 'release.yml'), 'name: release\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'feat!: document the breaking release process')

    setFixtureVersion(root, '1.2.5')
    git(root, 'add', 'frontend')
    git(root, 'commit', '-qm', 'chore: bump version')

    const result = runVersionCheck({ rootDir: root, baseRef: 'HEAD~3' })
    assert.equal(result.changes.commits.length, 3)
    assert.equal(result.classification.requiredLevel, 'patch')
    assert.equal(result.comparison.actualLevel, 'patch')
    assert.equal(result.classification.reasons.some(reason => reason.startsWith('feat!:')), false)
    const exemptCommit = result.changes.commits.find(commit => commit.subject === 'feat!: document the breaking release process')
    assert.ok(exemptCommit)
    for (const path of ['docs/release.md', 'frontend/src/lib/release.test.js', '.github/workflows/release.yml']) {
      assert.ok(exemptCommit.paths.includes(path))
    }
  })
})
