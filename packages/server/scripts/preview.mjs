import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../dist/runtime.mjs';
import { createHTTPServer } from '../src/http.mjs';

process.umask(0o077);
const port = Number(process.env.PREVIEW_PORT || 3201);
const origin = 'http://127.0.0.1:' + port;
const directory = await mkdtemp(join(tmpdir(), 'ait-node-preview-'));
const runtime = await createRuntime({
  dataDirectory: directory,
  variables: {
    ENVIRONMENT: 'development', ALLOW_REGISTRATION: 'true',
    MOCK_MODEL: 'true', ALLOWED_ORIGINS: origin,
  },
});
const server = createHTTPServer(runtime, {
  publicOrigin: origin, development: true,
  staticDirectory: fileURLToPath(new URL('../../frontend/dist', import.meta.url)),
});
server.listen(port, '127.0.0.1', () => console.log('Isolated local mock preview: ' + origin));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
  clearTimeout(deadline);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);
