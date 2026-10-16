import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuntime } from '../dist/runtime.mjs'
import { createHTTPServer, closeHTTPServer } from '../src/http.mjs'

process.umask(0o077)
const port = Number(process.env.PREVIEW_PORT || 3201)
const origin = 'http://127.0.0.1:' + port
const directory =
  process.env.PREVIEW_DATA_DIRECTORY || (await mkdtemp(join(tmpdir(), 'ait-node-preview-')))
const realModel = process.env.PREVIEW_USE_REAL_MODEL === 'true'
if (
  realModel &&
  (!process.env.TEXT_API_KEY?.trim() ||
    !process.env.TEXT_API_BASE_URL?.trim() ||
    !process.env.DEFAULT_MODEL?.trim())
) {
  throw new Error('Real preview requires TEXT_API_KEY, TEXT_API_BASE_URL and DEFAULT_MODEL')
}
const runtime = await createRuntime({
  dataDirectory: directory,
  variables: {
    ENVIRONMENT: 'development',
    ALLOW_REGISTRATION: 'true',
    ALLOW_GUEST_ACCESS: 'true',
    MOCK_MODEL: realModel ? 'false' : 'true',
    ALLOWED_ORIGINS: [origin, process.env.PREVIEW_FRONTEND_ORIGIN].filter(Boolean).join(','),
    ...(realModel
      ? {
          TEXT_API_KEY: process.env.TEXT_API_KEY,
          TEXT_API_BASE_URL: process.env.TEXT_API_BASE_URL,
          DEFAULT_MODEL: process.env.DEFAULT_MODEL,
          DEFAULT_FILE_MODEL: process.env.DEFAULT_FILE_MODEL || process.env.DEFAULT_MODEL,
          DEFAULT_MULTIMODAL_MODEL: process.env.DEFAULT_MULTIMODAL_MODEL,
          MULTIMODAL_USE_TEXT_PROVIDER: process.env.MULTIMODAL_USE_TEXT_PROVIDER,
          AGENT_DISABLE_THINKING: process.env.AGENT_DISABLE_THINKING
        }
      : {})
  }
})
const server = createHTTPServer(runtime, {
  publicOrigin: origin,
  development: true,
  staticDirectory: fileURLToPath(new URL('../../frontend/dist', import.meta.url))
})
server.listen(port, '127.0.0.1', () =>
  console.log(`Local ${realModel ? 'real model' : 'mock'} preview: ${origin}`)
)
let closing = false
async function close() {
  if (closing) return
  closing = true
  const deadline = setTimeout(() => process.exit(1), 10000)
  deadline.unref()
  await closeHTTPServer(server, runtime)
  clearTimeout(deadline)
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
