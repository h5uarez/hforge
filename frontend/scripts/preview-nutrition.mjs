import { mkdtemp } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, preview } from 'vite'

// Serve only the demo bundle, with no proxy to the training API.
const root = fileURLToPath(new URL('../', import.meta.url))
const outDir = await mkdtemp(join(tmpdir(), 'hforge-nutrition-'))
const addresses = Object.values(networkInterfaces()).flat()
const host = process.argv[2] || addresses.find(({ family, internal, address }) =>
  family === 'IPv4' && !internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
)?.address
if (!host) throw new Error('Pass the Wi-Fi IPv4 address as the first argument.')

process.env.VITE_DEMO = '1'
await build({ root, build: { outDir } })
const server = await preview({
  root, configFile: false, build: { outDir },
  preview: { host, port: 4191, strictPort: true },
})
server.printUrls()
