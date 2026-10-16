import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { once } from 'node:events'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, relative, extname, sep } from 'node:path'

const mediaTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webp': 'image/webp'
}

async function serveStatic(request, response, directory, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405).end()
    return
  }
  const root = await realpath(directory)
  let name
  try {
    name = decodeURIComponent(pathname)
  } catch {
    response.writeHead(400).end()
    return
  }
  if (name.includes('\0') || name.includes('\\')) {
    response.writeHead(400).end()
    return
  }
  let file = resolve(root, '.' + name)
  const outside = (candidate) => {
    const diff = relative(root, candidate)
    return diff === '..' || diff.startsWith('..' + sep) || resolve(root, diff) !== candidate
  }
  if (outside(file)) {
    response.writeHead(400).end()
    return
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
  } catch {
    if (extname(name)) {
      response.writeHead(404).end()
      return
    }
    file = resolve(root, 'index.html')
    name = '/index.html'
  }
  if (outside(await realpath(file))) {
    response.writeHead(404).end()
    return
  }
  const bytes = await readFile(file)
  response.writeHead(200, {
    'Content-Type': mediaTypes[extname(file)] || 'application/octet-stream',
    'Cache-Control': name.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(request.method === 'HEAD' ? undefined : bytes)
}

export function createHTTPServer(
  runtime,
  {
    publicOrigin,
    development = false,
    staticDirectory,
    log = (entry) => console.info(JSON.stringify(entry))
  }
) {
  const origin = new URL(publicOrigin)
  if (origin.origin !== publicOrigin || (!development && origin.protocol !== 'https:')) {
    throw new Error('A canonical HTTPS PUBLIC_ORIGIN is required')
  }
  let active = 0
  let streams = 0
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (incoming, outgoing) => {
    const requestId = randomUUID()
    const started = performance.now()
    outgoing.setHeader('X-Request-ID', requestId)
    let logged = false
    const record = (outcome) => {
      if (logged) return
      logged = true
      const path = (incoming.url || '').split('?')[0]
      const task = /^\/api\/tasks\/([a-f0-9]{64})(?:\/(events|cancel))?$/.exec(path)
      const route = task
        ? '/api/tasks/:id' + (task[2] ? '/' + task[2] : '')
        : /^\/api\/(?:auth\/(?:me|login|logout|register|guest|usage|files)|tasks|health|stats|upload\/(?:chunk|complete|status|delete))$/.test(
              path
            ) || path === '/healthz'
          ? path
          : path.startsWith('/api')
            ? '/api/*'
            : '/static'
      try {
        log({
          event: 'http.request',
          requestId,
          method: incoming.method,
          route,
          status: outgoing.headersSent ? outgoing.statusCode : 499,
          outcome,
          durationMs: Math.round(performance.now() - started),
          ...(task ? { taskId: task[1] } : {})
        })
      } catch {
        /* Logging must not interrupt request cleanup. */
      }
    }
    outgoing.once('finish', () => record('completed'))
    outgoing.once('close', () => record(outgoing.writableFinished ? 'completed' : 'disconnected'))
    if (active >= 16) {
      outgoing.writeHead(503, { Connection: 'close', 'Retry-After': '2' }).end()
      return
    }
    active++
    let streaming = false
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//')) {
        outgoing.writeHead(400).end()
        return
      }
      let path = incoming.url
      if (path === '/healthz') {
        if (!['GET', 'HEAD'].includes(incoming.method)) {
          outgoing.writeHead(405).end()
          return
        }
        outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        outgoing.end(
          incoming.method === 'HEAD'
            ? undefined
            : '{"status":"ok","runtime":"node","storage":"sqlite-files"}'
        )
        return
      }
      const isAPI = path === '/api' || path.startsWith('/api/') || path.startsWith('/api?')
      if (staticDirectory && !isAPI) {
        await serveStatic(
          incoming,
          outgoing,
          staticDirectory,
          new URL(publicOrigin + path).pathname
        )
        return
      }
      if (isAPI) {
        path = path.slice(4) || '/'
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (
          value !== undefined &&
          !['host', 'connection', 'transfer-encoding', 'cf-connecting-ip', 'x-request-id'].includes(
            name
          )
        ) {
          headers.set(name, Array.isArray(value) ? value.join(', ') : value)
        }
      }
      const ip = incoming.headers['x-real-ip']
      const trustedProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        incoming.socket.remoteAddress
      )
      const address =
        trustedProxy && typeof ip === 'string' && isIP(ip) ? ip : incoming.socket.remoteAddress
      headers.set('CF-Connecting-IP', address || 'unknown')
      headers.set('X-Request-ID', requestId)
      headers.delete('x-real-ip')
      headers.delete('x-forwarded-for')
      const controller = new AbortController()
      outgoing.on('close', () => {
        if (!outgoing.writableFinished) controller.abort()
      })
      let body
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        const limit = headers.get('content-type')?.includes('multipart/form-data')
          ? 6 * 1024 * 1024
          : 2 * 1024 * 1024
        const rejectBody = () => {
          outgoing.writeHead(413, { Connection: 'close', 'Content-Type': 'application/json' })
          outgoing.end('{"error":{"code":"BODY_TOO_LARGE","message":"Request body too large"}}')
        }
        if (Number(headers.get('content-length')) > limit) {
          rejectBody()
          return
        }
        const chunks = []
        let size = 0
        // Do not destroy the incoming socket before the 413 response can be sent.
        const iterator = incoming.iterator({ destroyOnReturn: false })
        for await (const chunk of iterator) {
          size += chunk.length
          if (size > limit) {
            rejectBody()
            return
          }
          chunks.push(chunk)
        }
        body = Buffer.concat(chunks, size)
      }
      const request = new Request(publicOrigin + path, {
        method: incoming.method,
        headers,
        body,
        duplex: 'half',
        signal: controller.signal
      })
      const response = await runtime.fetch(request)
      if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
        if (streams >= 32) {
          await response.body?.cancel()
          outgoing.writeHead(503, { 'Retry-After': '2' }).end()
          return
        }
        // Long-lived observers have a separate cap so task cancellation stays available.
        active--
        streams++
        streaming = true
      }
      const responseHeaders = {}
      response.headers.forEach((value, name) => {
        if (name !== 'set-cookie') responseHeaders[name] = value
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length) responseHeaders['set-cookie'] = cookies
      outgoing.writeHead(response.status, responseHeaders)
      if (response.headers.get('content-type')?.startsWith('text/event-stream'))
        outgoing.flushHeaders()
      if (!response.body || incoming.method === 'HEAD') {
        outgoing.end()
        return
      }
      const reader = response.body.getReader()
      try {
        while (!outgoing.destroyed) {
          const { done, value } = await reader.read()
          if (done) break
          if (!outgoing.write(value)) await once(outgoing, 'drain', { signal: controller.signal })
        }
        if (outgoing.destroyed) await reader.cancel()
      } catch (error) {
        await reader.cancel().catch(() => {})
        throw error
      } finally {
        reader.releaseLock()
      }
      outgoing.end()
    } catch {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        outgoing.end(
          '{"error":{"code":"SERVER_UNAVAILABLE","message":"Service temporarily unavailable"}}'
        )
      } else outgoing.destroy()
      console.error(JSON.stringify({ event: 'http.error', requestId, code: 'SERVER_UNAVAILABLE' }))
    } finally {
      if (streaming) streams--
      else active--
    }
  })
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  server.keepAliveTimeout = 5000
  server.maxConnections = 128
  return server
}

export async function closeHTTPServer(server, runtime) {
  const closing = new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  try {
    await runtime.close()
  } finally {
    server.closeAllConnections()
    await closing
  }
}
