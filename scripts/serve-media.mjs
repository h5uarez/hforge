import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const mediaRoot = resolve(process.env.MEDIA_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'media'))
const port = Number(process.env.MEDIA_PORT || 8888)
const contentTypes = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4'
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

  if (!/^\/(?:img|gif|video)\/.+/.test(pathname) || pathname.includes('\\') || pathname.includes('\0')) {
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

  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=2592000, immutable',
    'Content-Length': fileInfo.size,
    'Content-Type': contentTypes[extname(realFilePath).toLowerCase()] || 'application/octet-stream'
  }

  const range = request.headers.range
  let start = 0
  let end = fileInfo.size - 1
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/)
    if (!match || (match[1] === '' && match[2] === '')) {
      response.writeHead(416, { 'Content-Range': `bytes */${fileInfo.size}` }).end()
      return
    }
    if (match[1] === '') {
      const suffixLength = Number(match[2])
      if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
        response.writeHead(416, { 'Content-Range': `bytes */${fileInfo.size}` }).end()
        return
      }
      start = Math.max(0, fileInfo.size - suffixLength)
    } else {
      start = Number(match[1])
      end = match[2] === '' ? end : Number(match[2])
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= fileInfo.size || end < start) {
      response.writeHead(416, { 'Content-Range': `bytes */${fileInfo.size}` }).end()
      return
    }
    end = Math.min(end, fileInfo.size - 1)
    headers['Content-Length'] = end - start + 1
    headers['Content-Range'] = `bytes ${start}-${end}/${fileInfo.size}`
    response.writeHead(206, headers)
  } else {
    response.writeHead(200, headers)
  }

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  const stream = createReadStream(realFilePath, range ? { start, end } : undefined)
  stream.on('error', () => response.destroy())
  stream.pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${mediaRoot} at http://127.0.0.1:${port}`)
})
