import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const mediaRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'media')
const port = Number(process.env.MEDIA_PORT || 8888)
const contentTypes = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg'
}
const isOutside = value => value === '..' || value.startsWith(`..${sep}`)

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid MEDIA_PORT: ${process.env.MEDIA_PORT}`)
  process.exit(1)
}

const notFound = response => response.writeHead(404).end('Not found\n')

const mediaRootReal = await realpath(mediaRoot).catch(() => null)
if (!mediaRootReal) {
  console.error(`Media directory not found: ${mediaRoot}`)
  process.exit(1)
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed\n')
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(request.url.split('?')[0])
  } catch {
    notFound(response)
    return
  }

  if (!/^\/(?:img|gif)\/.+/.test(pathname) || pathname.includes('\\') || pathname.includes('\0')) {
    notFound(response)
    return
  }

  const segments = pathname.split('/')
  if (segments.some(segment => segment === '.' || segment === '..')) {
    notFound(response)
    return
  }

  const filePath = resolve(mediaRoot, `.${pathname}`)
  const relativeFilePath = relative(mediaRoot, filePath)
  if (isAbsolute(relativeFilePath) || isOutside(relativeFilePath)) {
    notFound(response)
    return
  }

  const realFilePath = await realpath(filePath).catch(() => null)
  const relativeRealFilePath = realFilePath && relative(mediaRootReal, realFilePath)
  if (!realFilePath || isAbsolute(relativeRealFilePath) || isOutside(relativeRealFilePath)) {
    notFound(response)
    return
  }

  const fileInfo = await stat(realFilePath).catch(() => null)
  if (!fileInfo?.isFile()) {
    notFound(response)
    return
  }

  response.writeHead(200, {
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': fileInfo.size,
    'Content-Type': contentTypes[extname(realFilePath).toLowerCase()] || 'application/octet-stream'
  })

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  const stream = createReadStream(realFilePath)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${mediaRoot} at http://127.0.0.1:${port}`)
})
