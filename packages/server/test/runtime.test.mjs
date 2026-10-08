import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../dist/runtime.mjs';
import { SQLiteStore } from '../src/sqlite-store.mjs';
import { createHTTPServer } from '../src/http.mjs';

const origin = 'http://127.0.0.1';
const variables = {
  ENVIRONMENT: 'development', ALLOW_REGISTRATION: 'true', MOCK_MODEL: 'true',
  ALLOWED_ORIGINS: origin,
};

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'ait-node-test-'));
  let runtime = await createRuntime({ dataDirectory: directory, variables: { ...variables, ...overrides } });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    get runtime() { return runtime; }, directory,
    async restart() {
      await runtime.close();
      runtime = await createRuntime({ dataDirectory: directory, variables: { ...variables, ...overrides }, pollMs: 10 });
    },
  };
}

function call(runtime, path, { method = 'GET', cookie, body, headers = {} } = {}) {
  const requestHeaders = { Origin: origin, ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (body && !(body instanceof FormData)) requestHeaders['Content-Type'] = 'application/json';
  return runtime.fetch(new Request(origin + path, {
    method, headers: requestHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  }));
}

async function register(runtime, username) {
  const response = await call(runtime, '/auth/register', {
    method: 'POST', body: { username, password: 'Isolated-Node-Test-2026!' },
  });
  assert.equal(response.status, 200);
  return { cookie: response.headers.getSetCookie()[0].split(';')[0], user: (await response.json()).user };
}

async function terminal(runtime, cookie, id) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await call(runtime, '/tasks/' + id, { cookie });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    if (!['pending', 'running'].includes(snapshot.task.status)) return snapshot.task;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Local task did not terminate');
}

test('accounts persist and sessions remain isolated after reopening SQLite', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'node-owner');
  await f.restart();
  const me = await call(f.runtime, '/auth/me', { cookie: owner.cookie });
  assert.equal((await me.json()).user.id, owner.user.id);
  const wrongAccount = await call(f.runtime, '/tasks', {
    cookie: owner.cookie, headers: { 'X-Account-ID': randomUUID() },
  });
  assert.equal(wrongAccount.status, 409);
  const anonymous = await call(f.runtime, '/tasks');
  assert.equal(anonymous.status, 401);
  const external = await call(f.runtime, '/auth/login', {
    method: 'POST', headers: { Origin: 'https://untrusted.invalid' },
    body: { username: 'node-owner', password: 'Isolated-Node-Test-2026!' },
  });
  assert.equal(external.status, 403);
});

async function guest(runtime, headers = {}) {
  const response = await call(runtime, '/auth/guest', { method: 'POST', body: {}, headers });
  assert.equal(response.status, 200);
  return { cookie: response.headers.getSetCookie()[0].split(';')[0], user: (await response.json()).user };
}

test('guest access is opt-in, origin-protected, secure and does not enable registration', async t => {
  const disabled = await fixture(t, { ALLOW_REGISTRATION: 'false' });
  assert.equal((await call(disabled.runtime, '/auth/guest', { method: 'POST', body: {} })).status, 403);
  assert.equal((await (await call(disabled.runtime, '/auth/me')).json()).guestEnabled, false);
  const f = await fixture(t, { ALLOW_GUEST_ACCESS: 'true', ALLOW_REGISTRATION: 'false' });
  assert.equal((await (await call(f.runtime, '/auth/me')).json()).guestEnabled, true);
  for (const Origin of ['https://untrusted.invalid', 'null', '']) {
    assert.equal((await call(f.runtime, '/auth/guest', { method: 'POST', headers: { Origin } })).status, 403);
  }
  assert.equal((await call(f.runtime, '/auth/guest')).status, 405);
  assert.equal((await call(f.runtime, '/auth/register', {
    method: 'POST', body: { username: 'guest-no-register', password: 'Isolated-Node-Test-2026!' },
  })).status, 403);
  f.runtime.env.ENVIRONMENT = 'production';
  f.runtime.env.ALLOWED_ORIGINS = 'https://app.test';
  const response = await f.runtime.fetch(new Request('https://app.test/auth/guest', {
    method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' }, body: '{}',
  }));
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /^ait_guest_session=/);
  assert.equal((await response.json()).user.guest, true);
});

test('guest sessions persist, reuse existing identities and never become the owner', async t => {
  const f = await fixture(t, { ALLOW_GUEST_ACCESS: 'true' });
  const owner = await register(f.runtime, 'protected-owner');
  const first = await guest(f.runtime);
  const second = await guest(f.runtime);
  assert.notEqual(first.user.id, owner.user.id);
  assert.notEqual(first.user.id, second.user.id);
  const reused = await call(f.runtime, '/auth/guest', { method: 'POST', cookie: first.cookie, body: {} });
  assert.equal((await reused.json()).user.id, first.user.id);
  assert.equal(reused.headers.get('set-cookie'), null);
  const protectedOwner = await call(f.runtime, '/auth/guest', { method: 'POST', cookie: owner.cookie, body: {} });
  assert.equal((await protectedOwner.json()).user.id, owner.user.id);
  assert.equal(protectedOwner.headers.get('set-cookie'), null);
  const both = owner.cookie + '; ' + first.cookie;
  assert.equal((await (await call(f.runtime, '/auth/me', { cookie: both })).json()).user.id, owner.user.id);
  await f.restart();
  assert.equal((await (await call(f.runtime, '/auth/me', { cookie: first.cookie })).json()).user.id, first.user.id);
  const spoofed = await call(f.runtime, '/auth/guest', {
    method: 'POST', cookie: first.cookie, body: {}, headers: { 'X-Account-ID': owner.user.id },
  });
  assert.equal(spoofed.status, 409);
  await call(f.runtime, '/auth/logout', { method: 'POST', cookie: first.cookie, body: {} });
  assert.equal((await call(f.runtime, '/tasks', { cookie: first.cookie })).status, 401);
});

test('guest tasks and uploaded files remain private to each session', async t => {
  const f = await fixture(t, { ALLOW_GUEST_ACCESS: 'true' });
  const first = await guest(f.runtime);
  const second = await guest(f.runtime);
  const created = await call(f.runtime, '/tasks', {
    method: 'POST', cookie: first.cookie, headers: { 'Idempotency-Key': randomUUID() },
    body: { messages: [{ role: 'user', content: 'Synthetic guest isolation check.' }] },
  });
  assert.equal(created.status, 202);
  const id = (await created.json()).task.id;
  assert.equal((await call(f.runtime, '/tasks/' + id, { cookie: second.cookie })).status, 404);
  assert.deepEqual((await (await call(f.runtime, '/tasks', { cookie: second.cookie })).json()).tasks, []);
  const bytes = Buffer.from('Synthetic guest file.\n');
  const fileId = 'guest-' + randomUUID();
  const fileHash = createHash('md5').update(bytes).digest('hex');
  const form = new FormData();
  for (const [key, value] of Object.entries({
    fileId, fileName: 'guest.txt', fileSize: String(bytes.length), fileHash,
    mimeType: 'text/plain', chunkIndex: '0', totalChunks: '1',
  })) form.set(key, value);
  form.set('chunk', new File([bytes], 'guest.txt', { type: 'text/plain' }));
  assert.equal((await call(f.runtime, '/upload/chunk', { method: 'POST', cookie: first.cookie, body: form })).status, 200);
  assert.equal((await call(f.runtime, '/upload/status?fileId=' + fileId, { cookie: second.cookie })).status, 404);
  assert.equal((await call(f.runtime, '/upload/delete?fileId=' + fileId, {
    method: 'POST', cookie: second.cookie, body: {},
  })).status, 404);
  assert.deepEqual((await (await call(f.runtime, '/auth/files', { cookie: second.cookie })).json()).files, []);
  assert.equal((await call(f.runtime, '/upload/delete?fileId=' + fileId, {
    method: 'POST', cookie: first.cookie, body: {},
  })).status, 200);
});

test('guest creation has persistent IP and total-capacity limits', async t => {
  const f = await fixture(t, { ALLOW_GUEST_ACCESS: 'true' });
  for (let index = 0; index < 10; index++) await guest(f.runtime);
  const limited = await call(f.runtime, '/auth/guest', { method: 'POST', body: {} });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  await f.restart();
  assert.equal((await call(f.runtime, '/auth/guest', { method: 'POST', body: {} })).status, 429);
  for (let index = 0; index < 100; index++) {
    assert.equal((await call(f.runtime, '/auth/guest', { method: 'POST', body: {} })).status, 429);
  }
  await guest(f.runtime, { 'CF-Connecting-IP': '192.0.2.77' });
  const capped = await fixture(t, { ALLOW_GUEST_ACCESS: 'true', MAX_GUEST_SESSIONS: '2' });
  await guest(capped.runtime, { 'CF-Connecting-IP': '192.0.2.1' });
  await guest(capped.runtime, { 'CF-Connecting-IP': '192.0.2.2' });
  const capacity = await call(capped.runtime, '/auth/guest', {
    method: 'POST', body: {}, headers: { 'CF-Connecting-IP': '192.0.2.3' },
  });
  assert.equal(capacity.status, 429);
  assert.equal((await capacity.json()).error.code, 'GUEST_CAPACITY');
});

test('queued task restarts once, replays idempotently and rejects another owner', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'task-owner');
  const other = await register(f.runtime, 'task-other');
  const key = randomUUID();
  const body = { messages: [{ role: 'user', content: 'Describe this isolated local test.' }] };
  const create = () => call(f.runtime, '/tasks', {
    cookie: owner.cookie, method: 'POST', body, headers: { 'Idempotency-Key': key },
  });
  const first = await create();
  assert.equal(first.status, 202);
  const id = (await first.json()).task.id;
  await f.restart();
  const completed = await terminal(f.runtime, owner.cookie, id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.metadata.metrics.modelCalls, 1);
  const replay = await create();
  assert.equal(replay.status, 202);
  assert.equal((await replay.json()).replayed, true);
  const foreign = await call(f.runtime, '/tasks/' + id, { cookie: other.cookie });
  assert.equal(foreign.status, 404);
  const changed = await call(f.runtime, '/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { messages: [{ role: 'user', content: 'Different content.' }] },
    headers: { 'Idempotency-Key': key },
  });
  assert.equal(changed.status, 409);
});

test('claimed task is interrupted after restart without a second model call', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'interrupted-owner');
  const created = await call(f.runtime, '/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { messages: [{ role: 'user', content: 'Interrupt before a model response.' }] },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(created.status, 202);
  const id = (await created.json()).task.id;
  await f.runtime.close();
  const database = new SQLiteStore(join(f.directory, 'state.sqlite'));
  const storage = database.storage('tasks', id);
  const record = await storage.get('record');
  record.phase = 'claimed';
  record.task.status = 'running';
  await storage.put('record', record);
  await storage.setAlarm(Date.now() + 600000);
  await database.close();
  await f.restart();
  const task = await terminal(f.runtime, owner.cookie, id);
  assert.equal(task.status, 'failed');
  assert.equal(task.metadata.errorCode, 'TASK_INTERRUPTED');
  assert.equal(task.metadata.metrics.modelCalls, 0);
});

test('owned upload, version verification, file-task citations and deletion use the local bucket', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'upload-owner');
  const bytes = Buffer.from('Project: local node migration.\nDelivery: 2026-10-01.\nOwner: synthetic fixture.\n');
  const fileId = 'fixture-' + randomUUID();
  const hash = createHash('md5').update(bytes).digest('hex');
  const form = new FormData();
  for (const [key, value] of Object.entries({
    fileId, fileName: 'delivery.md', fileSize: String(bytes.length), fileHash: hash,
    mimeType: 'text/markdown', chunkIndex: '0', totalChunks: '1',
  })) form.set(key, value);
  form.set('chunk', new File([bytes], 'delivery.md', { type: 'text/markdown' }));
  const chunk = await call(f.runtime, '/upload/chunk', { cookie: owner.cookie, method: 'POST', body: form });
  assert.equal(chunk.status, 200);
  const merged = await call(f.runtime, '/upload/complete', {
    cookie: owner.cookie, method: 'POST',
    body: { fileId, fileHash: hash, fileName: 'delivery.md', mimeType: 'text/markdown' },
  });
  assert.equal(merged.status, 200);
  const file = (await merged.json()).file;
  assert.equal(file.fileHash, hash);
  const storedMetadata = await f.runtime.env.CHUNK_STORAGE.get(
    'owned-' + createHash('sha256').update(owner.user.id + '\0' + fileId).digest('hex'),
  ).fetch(new Request('https://chunks/?action=getMetadata&fileId=' +
    'owned-' + createHash('sha256').update(owner.user.id + '\0' + fileId).digest('hex')));
  assert.equal((await storedMetadata.json()).serverContentHash, createHash('sha256').update(bytes).digest('hex'));
  await f.restart();
  const created = await call(f.runtime, '/tasks', {
    cookie: owner.cookie, method: 'POST',
    body: { messages: [{ role: 'user', content: 'What is the delivery date? Cite the source.' }], files: [file] },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  assert.equal(created.status, 202);
  const task = await terminal(f.runtime, owner.cookie, (await created.json()).task.id);
  assert.equal(task.status, 'completed');
  assert.ok(task.metadata.sources.length > 0);
  assert.ok(task.metadata.sources[0].excerpt.includes('2026-10-01'));
  assert.equal(task.metadata.sources[0].fileHash, createHash('sha256').update(bytes).digest('hex'));
  const deleted = await call(f.runtime, '/upload/delete?fileId=' + encodeURIComponent(file.fileId), {
    cookie: owner.cookie, method: 'POST', body: {},
  });
  assert.equal(deleted.status, 200);
  const files = await call(f.runtime, '/auth/files', { cookie: owner.cookie });
  assert.equal((await files.json()).files.length, 0);
});

test('large chunks resume after restart, reject foreign access, and complete without KV size overflow', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'chunk-owner');
  const other = await register(f.runtime, 'chunk-foreign');
  const bytes = Buffer.alloc(384 * 1024, 65);
  const fileId = 'large-' + randomUUID();
  const hash = createHash('md5').update(bytes).digest('hex');
  const size = bytes.length / 2;
  async function upload(index) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      fileId, fileName: 'large.txt', fileSize: String(bytes.length), fileHash: hash,
      mimeType: 'text/plain', chunkIndex: String(index), totalChunks: '2', chunkSize: String(size),
    })) form.set(key, value);
    form.set('chunk', new File([bytes.subarray(index * size, (index + 1) * size)], 'large.txt'));
    const response = await call(f.runtime, '/upload/chunk', { cookie: owner.cookie, method: 'POST', body: form });
    assert.equal(response.status, 200);
  }
  await upload(0);
  await f.restart();
  const status = await call(f.runtime, '/upload/status?fileId=' + fileId, { cookie: owner.cookie });
  assert.deepEqual((await status.json()).receivedIndices, [0]);
  assert.equal((await call(f.runtime, '/upload/status?fileId=' + fileId, { cookie: other.cookie })).status, 404);
  await upload(0);
  await upload(1);
  const merged = await call(f.runtime, '/upload/complete', {
    cookie: owner.cookie, method: 'POST', body: { fileId, fileHash: hash },
  });
  assert.equal(merged.status, 200);
  assert.equal((await merged.json()).file.size, bytes.length);
});

test('queued cancellation stays cancelled across restart without a model call', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'cancel-owner');
  const response = await call(f.runtime, '/tasks', {
    cookie: owner.cookie, method: 'POST',
    headers: { 'Idempotency-Key': randomUUID() },
    body: { messages: [{ role: 'user', content: 'Cancel synthetic task.' }] },
  });
  const id = (await response.json()).task.id;
  assert.equal((await call(f.runtime, '/tasks/' + id + '/cancel', {
    cookie: owner.cookie, method: 'POST', body: {},
  })).status, 200);
  await f.restart();
  const task = await terminal(f.runtime, owner.cookie, id);
  assert.equal(task.status, 'cancelled');
  assert.equal(task.metadata.metrics.modelCalls, 0);
});

test('production without credentials rejects task creation instead of pretending to answer', async t => {
  const f = await fixture(t, { ENVIRONMENT: 'production', MOCK_MODEL: 'false' });
  const response = await call(f.runtime, '/tasks', { method: 'POST', body: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'MODEL_NOT_CONFIGURED');
  const server = createHTTPServer(f.runtime, { publicOrigin: origin, development: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const http = await fetch('http://127.0.0.1:' + server.address().port + '/api/tasks', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(http.status, 503);
  assert.equal((await http.json()).error.code, 'MODEL_NOT_CONFIGURED');
});

test('runtime hides internal handler errors while keeping expected account errors', async t => {
  const f = await fixture(t);
  const owner = await register(f.runtime, 'safe-error-owner');
  f.runtime.env.ACCOUNTS = { get() { return { fetch() { throw new Error('private database path /secret/token'); } }; } };
  const response = await call(f.runtime, '/auth/me', { cookie: owner.cookie });
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret|database/);
});

test('owner CLI provisions a persisted account without printing its password', async t => {
  const f = await fixture(t);
  await f.runtime.close();
  const destination = join(f.directory, 'owner.txt');
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../dist/admin.mjs', import.meta.url)), 'cli-owner', destination,
  ], { env: { ...process.env, DATA_DIRECTORY: f.directory } });
  const credentials = await readFile(destination, 'utf8');
  const password = credentials.match(/^password=(.+)$/m)[1];
  assert.equal(stdout.includes(password), false);
  assert.equal(stderr.includes(password), false);
  await f.restart();
  const login = await call(f.runtime, '/auth/login', {
    method: 'POST', body: { username: 'cli-owner', password },
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.username, 'cli-owner');
});

test('production fails closed for mock mode and data directory cannot have two runtimes', async t => {
  const f = await fixture(t);
  await assert.rejects(createRuntime({ dataDirectory: f.directory, variables }), /already owns/);
  await f.runtime.close();
  await assert.rejects(createRuntime({
    dataDirectory: f.directory, variables: { ENVIRONMENT: 'production', MOCK_MODEL: 'true' },
  }), /Mock models/);
});

test('real HTTP adapter forwards cookies, enforces origin and ignores spoofed CF IP', async t => {
  const f = await fixture(t);
  const server = createHTTPServer(f.runtime, { publicOrigin: origin, development: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const response = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': 'attacker-controlled' },
    body: JSON.stringify({ username: 'http-owner', password: 'Isolated-Node-Test-2026!' }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0];
  assert.ok(cookie.includes('HttpOnly'));
  const me = await fetch(base + '/api/auth/me', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await me.json()).user.username, 'http-owner');
});
