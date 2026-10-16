import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { createHTTPServer, closeHTTPServer } from '../src/http.mjs'

async function fixture(t, fetch, options = {}) {
  const server = createHTTPServer(
    { fetch },
    { publicOrigin: 'http://localhost', development: true, ...options }
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { server, base: 'http://127.0.0.1:' + server.address().port }
}

test('static files, SPA fallback, cache policy, malformed paths and methods', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ait-http-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(join(directory, 'assets'))
  await writeFile(join(directory, 'index.html'), '<h1>fixture</h1>')
  await writeFile(join(directory, 'assets', 'fixture.js'), 'export default 1')
  const { base } = await fixture(t, () => Response.json({ api: true }), {
    staticDirectory: directory
  })
  assert.equal(await (await fetch(base + '/workspace')).text(), '<h1>fixture</h1>')
  const asset = await fetch(base + '/assets/fixture.js')
  assert.match(asset.headers.get('cache-control'), /immutable/)
  assert.equal((await fetch(base + '/missing.js')).status, 404)
  assert.equal((await fetch(base + '/%FF')).status, 400)
  assert.equal((await fetch(base + '/%5C..%5Csecrets')).status, 400)
  assert.equal((await fetch(base + '/%00')).status, 400)
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405)
  assert.equal((await fetch(base + '/healthz', { method: 'POST' })).status, 405)
  assert.equal(await (await fetch(base + '/', { method: 'HEAD' })).text(), '')
  assert.deepEqual(await (await fetch(base + '/api/tasks')).json(), { api: true })
})

test('bounds actual chunked bodies before invoking handlers', async (t) => {
  let calls = 0
  const { base } = await fixture(t, () => {
    calls++
    return Response.json({ ok: true })
  })
  const status = await new Promise((resolve, reject) => {
    const req = request(
      base + '/api/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      }
    )
    req.on('error', reject)
    req.write(Buffer.alloc(1024 * 1024 + 1, 32))
    req.end(Buffer.alloc(1024 * 1024, 32))
  })
  assert.equal(status, 413)
  assert.equal(calls, 0)
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', body: '{}' })).status, 200)
})

test('masks internal errors and overwrites client identity headers', async (t) => {
  const { base } = await fixture(t, (req) => {
    assert.equal(req.headers.get('CF-Connecting-IP'), '127.0.0.1')
    assert.equal(req.headers.get('x-forwarded-for'), null)
    throw new Error('sqlite path /secret/token')
  })
  const response = await fetch(base + '/api/tasks', {
    headers: { 'CF-Connecting-IP': 'spoofed', 'X-Real-IP': 'invalid', 'X-Forwarded-For': 'spoofed' }
  })
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /secret|sqlite/)
})

test('streams responses without waiting for the producer to complete', async (t) => {
  let release
  let requested
  const pending = new Promise((resolve) => {
    requested = resolve
  })
  const { base } = await fixture(
    t,
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: first\n\n'))
            release = () => {
              controller.enqueue(new TextEncoder().encode('data: final\n\n'))
              controller.close()
            }
            requested()
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  )
  const response = await fetch(base + '/api/tasks')
  await pending
  const reader = response.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/)
  release()
  assert.match(new TextDecoder().decode((await reader.read()).value), /final/)
  assert.equal((await reader.read()).done, true)
})

test('flushes SSE headers before content and frees disconnected readers', async (t) => {
  let cancelled
  const released = new Promise((resolve) => {
    cancelled = resolve
  })
  const { base } = await fixture(
    t,
    (req) =>
      new Response(
        new ReadableStream({
          start(controller) {
            req.signal.addEventListener(
              'abort',
              () => {
                controller.close()
                cancelled()
              },
              { once: true }
            )
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  )
  const controller = new AbortController()
  const response = await fetch(base + '/api/tasks/test/events', { signal: controller.signal })
  assert.equal(response.status, 200)
  controller.abort()
  await released
})

test('SSE observers do not occupy regular request slots and have a separate bounded cap', async (t) => {
  const { base } = await fixture(t, (req) => {
    if (!req.url.endsWith('/events')) return Response.json({ ok: true })
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': connected\n\n'))
          req.signal.addEventListener('abort', () => controller.close(), { once: true })
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream' } }
    )
  })
  const controllers = []
  try {
    for (let index = 0; index < 32; index++) {
      const controller = new AbortController()
      controllers.push(controller)
      assert.equal(
        (await fetch(base + '/api/tasks/test/events', { signal: controller.signal })).status,
        200
      )
    }
    assert.equal((await fetch(base + '/api/tasks/test/events')).status, 503)
    assert.deepEqual(
      await (await fetch(base + '/api/tasks/test/cancel', { method: 'POST' })).json(),
      { ok: true }
    )
  } finally {
    controllers.forEach((controller) => controller.abort())
  }
})

test('request IDs join responses, trusted handler context and safe access logs', async (t) => {
  const logs = []
  let forwarded
  const { base } = await fixture(
    t,
    (req) => {
      forwarded = req.headers.get('X-Request-ID')
      return Response.json(
        { error: { code: 'TEST_FAILURE', message: 'Try again' } },
        { status: 409 }
      )
    },
    { log: (entry) => logs.push(entry) }
  )
  const id = 'a'.repeat(64)
  const response = await fetch(`${base}/api/tasks/${id}/cancel?token=private-query`, {
    method: 'POST',
    headers: { 'X-Request-ID': 'attacker-id', Cookie: 'private-cookie' },
    body: 'private-prompt'
  })
  await response.text()
  assert.match(response.headers.get('X-Request-ID'), /^[a-f0-9-]{36}$/)
  assert.equal(forwarded, response.headers.get('X-Request-ID'))
  assert.notEqual(forwarded, 'attacker-id')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].requestId, forwarded)
  assert.equal(logs[0].route, '/api/tasks/:id/cancel')
  assert.equal(logs[0].taskId, id)
  assert.equal(logs[0].status, 409)
  assert.doesNotMatch(JSON.stringify(logs), /private|attacker/)
  await fetch(base + '/api/private-file-name?token=secret')
  assert.equal(logs.at(-1).route, '/api/*')
  assert.doesNotMatch(JSON.stringify(logs), /private|secret/)
})

test('graceful shutdown releases long-lived SSE before waiting on HTTP close', async (t) => {
  const controller = new AbortController()
  const runtime = {
    fetch: (req) =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode(': connected\n\n'))
            AbortSignal.any([req.signal, controller.signal]).addEventListener(
              'abort',
              () => stream.close(),
              { once: true }
            )
          }
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      ),
    close: async () => controller.abort()
  }
  const server = createHTTPServer(runtime, {
    publicOrigin: 'http://localhost',
    development: true,
    log: () => {}
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.closeAllConnections())
  const response = await fetch(
    'http://127.0.0.1:' + server.address().port + '/api/tasks/test/events'
  )
  const reader = response.body.getReader()
  await reader.read()
  const start = Date.now()
  await closeHTTPServer(server, runtime)
  assert.ok(Date.now() - start < 2000)
  assert.equal((await reader.read()).done, true)
  assert.equal(controller.signal.aborted, true)
})
