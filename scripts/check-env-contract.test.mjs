import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFile(resolve(root, file), 'utf8')
const envAssignment = /^([A-Z][A-Z0-9_]*)=(.*)$/gm
const required = ['EXERCISE_MEDIA_SOURCE']
const documented = ['RP_ID', 'ORIGIN', 'WEB_PORT', 'RP_NAME']
const optional = ['ADMIN_UIDS', 'INVITE_ONLY', 'IMAGE_TAG', 'SESSION_DAYS']
const operatorVariables = [...required, ...documented, ...optional]
const deadDemoUrl = 'https://duartesantos8.github.io/openGym/'
const publishedDemoSurfaces = [
  'README.md',
  'website/index.html',
  'website/about.html',
  'website/docs.html'
]

function envVariables(source) {
  return new Map([...source.matchAll(envAssignment)].map(([, key, value]) => [key, value]))
}

test('publishes only the safe, source-backed environment contract', async () => {
  const example = await read('.env.example')
  const variables = envVariables(example)

  assert.deepEqual([...variables.keys()], operatorVariables)
  assert.equal(variables.get('EXERCISE_MEDIA_SOURCE'), '', 'the operator must supply the media source')
  assert.match(example, /images\/.*videos[\s\S]*EXERCISE_MEDIA_SOURCE=/i)
  for (const forbidden of ['PORT', 'DATA_DIR', 'VAPID_SUBJECT']) {
    assert.equal(variables.has(forbidden), false, `${forbidden} is Compose- or server-owned`)
  }
  assert.doesNotMatch(example, /(?:SECRET|TOKEN|PASSWORD|PRIVATE)/i)
})

test('Compose, API, and onboarding documents agree on operator configuration', async () => {
  const [compose, productionCompose, api, readme, contributing, selfHosting] = await Promise.all([
    read('docker-compose.yml'),
    read('docker-compose.prod.yml'),
    read('api/server.js'),
    read('README.md'),
    read('CONTRIBUTING.md'),
    read('docs/SELF_HOSTING.md')
  ])

  assert.match(compose, /EXERCISE_MEDIA_SOURCE:\?Set EXERCISE_MEDIA_SOURCE/)
  assert.match(compose, /WEB_PORT:-8080/)
  assert.match(productionCompose, /IMAGE_TAG:-latest/)
  for (const variable of ['RP_ID', 'ORIGIN', 'RP_NAME', 'ADMIN_UIDS', 'INVITE_ONLY', 'SESSION_DAYS']) {
    assert.match(api, new RegExp(`process\\.env\\.${variable}`))
  }
  assert.match(api, /process\.env\.VAPID_SUBJECT/)

  for (const variable of operatorVariables) {
    assert.match(readme, new RegExp(`\\b${variable}\\b`), `README must document ${variable}`)
    assert.match(selfHosting, new RegExp(`\\b${variable}\\b`), `self-hosting guide must document ${variable}`)
  }
  assert.match(contributing, /EXERCISE_MEDIA_SOURCE/)
  assert.match(contributing, /docs\/SELF_HOSTING\.md/)
  for (const document of [readme, contributing, selfHosting]) {
    assert.doesNotMatch(document, /(?:^|\n)\s*(?:PORT|DATA_DIR)=/m)
  }
})

test('does not publish the verified dead demo destination', async () => {
  const surfaces = await Promise.all(publishedDemoSurfaces.map(async file => [file, await read(file)]))
  const references = surfaces.flatMap(([file, source]) =>
    Array.from(source.matchAll(new RegExp(deadDemoUrl.replaceAll('/', '\\/'), 'g')), () => file)
  )

  assert.equal(references.length, 0, `found ${references.length} dead demo references: ${references.join(', ')}`)
})
