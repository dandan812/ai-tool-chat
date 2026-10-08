import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3200';
assert.ok(
  ['http://127.0.0.1:3200', 'https://chat.i-tool-chat.store'].includes(base),
  'Smoke credentials may only be sent to the approved application origin',
);
const origin = 'https://chat.i-tool-chat.store';
const credentials = await readFile('/var/lib/ai-tool-chat-credentials/owner.txt', 'utf8');
const username = credentials.match(/^username=(.+)$/m)?.[1];
const password = credentials.match(/^password=(.+)$/m)?.[1];
if (!username || !password) throw new Error('Invalid protected owner credential file');
const health = await (await fetch(base + '/healthz')).json();
assert.equal(health.runtime, 'node');
const state = await stat('/var/lib/ai-tool-chat/state.sqlite');
assert.equal(state.mode & 0o077, 0);
assert.equal(state.uid, process.getuid());
const objects = await stat('/var/lib/ai-tool-chat/objects');
assert.equal(objects.mode & 0o077, 0);
assert.equal(objects.uid, process.getuid());
let cookie;
async function call(path, options = {}) {
  const headers = { Origin: origin, ...options.headers };
  if (cookie) headers.Cookie = cookie;
  if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(base + '/api' + path, { ...options, headers });
}
const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
assert.equal(login.status, 200);
assert.ok(login.headers.getSetCookie()[0].includes('HttpOnly'));
assert.ok(login.headers.getSetCookie()[0].includes('Secure'));
cookie = login.headers.getSetCookie()[0].split(';')[0];
assert.equal((await (await call('/auth/me')).json()).user.username, username);
const bytes = Buffer.from('Synthetic deployment verification only.\nNo user documents or paid model requests.\n');
const fileId = 'deploy-smoke-' + randomUUID();
const fileHash = createHash('md5').update(bytes).digest('hex');
let uploadAttempted = false;
try {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    fileId, fileName: 'deployment-smoke.txt', fileHash, fileSize: String(bytes.length),
    mimeType: 'text/plain', totalChunks: '1', chunkIndex: '0',
  })) form.set(key, value);
  form.set('chunk', new File([bytes], 'deployment-smoke.txt', { type: 'text/plain' }));
  uploadAttempted = true;
  const chunk = await call('/upload/chunk', { method: 'POST', body: form });
  assert.equal(chunk.status, 200);
  const complete = await call('/upload/complete', {
    method: 'POST', body: JSON.stringify({ fileId, fileHash }),
  });
  assert.equal(complete.status, 200);
  const status = await call('/upload/status?fileId=' + fileId);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).isComplete, true);
} finally {
  if (uploadAttempted) {
    const deleted = await call('/upload/delete?fileId=' + fileId, { method: 'POST', body: '{}' });
    assert.equal(deleted.status, 200);
  }
}
assert.equal((await call('/upload/status?fileId=' + fileId)).status, 404);
assert.equal((await call('/auth/register', {
  method: 'POST', body: JSON.stringify({ username: 'no-public-registration', password: 'Synthetic-Registration-Test-Only!' }),
})).status, 403);
const features = (await (await call('/health')).json()).features;
if (!features.bailianText) {
  const unavailable = await call('/tasks', { method: 'POST', body: '{}' });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error.code, 'MODEL_NOT_CONFIGURED');
}
assert.equal((await call('/auth/logout', { method: 'POST', body: '{}' })).status, 200);
console.log(JSON.stringify({
  login: 'passed', upload: 'passed', delete: 'passed', privateLinuxStorage: 'passed',
  publicRegistration: 'disabled', modelConfigured: features.bailianText,
  paidModelRequests: 0,
}));
