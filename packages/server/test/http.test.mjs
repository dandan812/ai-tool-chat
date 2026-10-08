import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createHTTPServer } from '../src/http.mjs';

async function fixture(t, fetch, options = {}) {
  const server = createHTTPServer({ fetch }, { publicOrigin: 'http://localhost', development: true, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

test('static files, SPA fallback, cache policy, malformed paths and methods', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ait-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<h1>fixture</h1>');
  await writeFile(join(directory, 'assets', 'fixture.js'), 'export default 1');
  const { base } = await fixture(t, () => Response.json({ api: true }), { staticDirectory: directory });
  assert.equal(await (await fetch(base + '/workspace')).text(), '<h1>fixture</h1>');
  const asset = await fetch(base + '/assets/fixture.js');
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  assert.equal((await fetch(base + '/%FF')).status, 400);
  assert.equal((await fetch(base + '/%5C..%5Csecrets')).status, 400);
  assert.equal((await fetch(base + '/%00')).status, 400);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/healthz', { method: 'POST' })).status, 405);
  assert.equal(await (await fetch(base + '/', { method: 'HEAD' })).text(), '');
  assert.deepEqual(await (await fetch(base + '/api/tasks')).json(), { api: true });
});

test('bounds actual chunked bodies before invoking handlers', async t => {
  let calls = 0;
  const { base } = await fixture(t, () => { calls++; return Response.json({ ok: true }); });
  const status = await new Promise((resolve, reject) => {
    const req = request(base + '/api/tasks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(Buffer.alloc(1024 * 1024 + 1, 32));
    req.end(Buffer.alloc(1024 * 1024, 32));
  });
  assert.equal(status, 413);
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/api/tasks', { method: 'POST', body: '{}' })).status, 200);
});

test('masks internal errors and overwrites client identity headers', async t => {
  const { base } = await fixture(t, req => {
    assert.equal(req.headers.get('CF-Connecting-IP'), '127.0.0.1');
    assert.equal(req.headers.get('x-forwarded-for'), null);
    throw new Error('sqlite path /secret/token');
  });
  const response = await fetch(base + '/api/tasks', {
    headers: { 'CF-Connecting-IP': 'spoofed', 'X-Real-IP': 'invalid', 'X-Forwarded-For': 'spoofed' },
  });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret|sqlite/);
});

test('streams responses without waiting for the producer to complete', async t => {
  let release;
  let requested;
  const pending = new Promise(resolve => { requested = resolve; });
  const { base } = await fixture(t, () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      release = () => { controller.enqueue(new TextEncoder().encode('data: final\n\n')); controller.close(); };
      requested();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const response = await fetch(base + '/api/tasks');
  await pending;
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  release();
  assert.match(new TextDecoder().decode((await reader.read()).value), /final/);
  assert.equal((await reader.read()).done, true);
});
