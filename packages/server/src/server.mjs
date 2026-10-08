import { createRuntime } from './runtime.mjs';
import { createHTTPServer } from './http.mjs';

process.umask(0o077);
const variables = {};
for (const key of [
  'ENVIRONMENT', 'ALLOW_REGISTRATION', 'ALLOW_GUEST_ACCESS', 'MAX_GUEST_SESSIONS', 'QWEN_API_KEY', 'DEFAULT_MODEL',
  'DEFAULT_FILE_MODEL', 'DEFAULT_MULTIMODAL_MODEL', 'DAILY_TOKEN_BUDGET',
  'TASK_TOKEN_BUDGET', 'MAX_CONCURRENT_TASKS', 'MAX_MODEL_CALLS', 'MAX_FILE_BYTES',
  'MAX_USER_FILE_BYTES', 'MODEL_PRICES_JSON', 'MOCK_MODEL', 'NODE_TASK_CONCURRENCY',
]) {
  if (process.env[key] !== undefined) variables[key] = process.env[key];
}
const publicOrigin = process.env.PUBLIC_ORIGIN;
if (!publicOrigin) throw new Error('PUBLIC_ORIGIN is required');
variables.ALLOWED_ORIGINS = publicOrigin;
const runtime = await createRuntime({
  dataDirectory: process.env.DATA_DIRECTORY || './data', variables,
});
const server = createHTTPServer(runtime, {
  publicOrigin, development: variables.ENVIRONMENT === 'development',
  staticDirectory: process.env.FRONTEND_DIRECTORY,
});
const port = Number(process.env.PORT || 3200);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid PORT');
server.listen(port, '127.0.0.1', () => console.log(`Node backend listening on loopback port ${port}`));
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  await new Promise(resolve => server.close(resolve));
  await runtime.close();
  clearTimeout(deadline);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
