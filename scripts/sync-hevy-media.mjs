#!/usr/bin/env node
// Copy the operator-supplied Hevy binaries into the runtime media volume. This is deliberately
// separate from the catalog importer so a 195 MB media payload never enters the git change.

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
const destination = process.argv[3] || join(ROOT, 'media')
if (!source) {
  console.error('Usage: node scripts/sync-hevy-media.mjs <hevy-media-directory> [destination-media-directory]')
  process.exit(2)
}

// Hevy's export uses eight-character uppercase alphanumeric IDs; three valid IDs contain
// G/S/H/K and must not be discarded by a hexadecimal-only filename filter.
const files = (await readdir(source)).filter(file => /^[0-9A-Z]{8}\.(jpg|jpeg|png|mp4)$/i.test(file)).sort()
if (!files.length) throw new Error(`No Hevy media files found in ${source}`)
await mkdir(join(destination, 'img'), { recursive: true })
await mkdir(join(destination, 'video'), { recursive: true })
for (const file of files) {
  const targetDir = /\.mp4$/i.test(file) ? 'video' : 'img'
  await copyFile(join(source, file), join(destination, targetDir, file))
}
const bytes = (await Promise.all(files.map(file => stat(join(source, file))))).reduce((sum, info) => sum + info.size, 0)
console.log(JSON.stringify({ source: resolve(source), destination: resolve(destination), files: files.length, bytes }, null, 2))
