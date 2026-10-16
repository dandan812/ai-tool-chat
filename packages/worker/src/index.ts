import type { Env } from './types'
import { NotFoundError, WorkerError } from './types'
import {
  compose,
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging
} from './infrastructure/middleware'
import { ChunkStorage } from './upload/chunkStorage'
import { AccountDirectory, requireUser, handleAuthRequest, getUserUsage } from './platform/accounts'
import { DurableTask } from './core/durableTask'
import { handleTaskRequest } from './handlers/taskHandlers'
import {
  handleUploadChunk,
  handleUploadComplete,
  handleUploadStatus,
  handleUploadDelete
} from './handlers/uploadHandlers'
import { handleHealthCheck } from './handlers/systemHandlers'
export { ChunkStorage, AccountDirectory, DurableTask }

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/health') {
    if (request.method !== 'GET')
      throw new WorkerError('Method Not Allowed', 'METHOD_NOT_ALLOWED', 405)
    return handleHealthCheck(env)
  }
  if (url.pathname.startsWith('/auth/')) return handleAuthRequest(request, env)
  const user = await requireUser(request, env)
  if (url.pathname === '/' || url.pathname === '/chat') {
    url.pathname = '/tasks'
    return handleTaskRequest(new Request(url, request), env, user)
  }
  if (url.pathname === '/tasks' || url.pathname.startsWith('/tasks/'))
    return handleTaskRequest(request, env, user)
  switch (url.pathname) {
    case '/upload/chunk':
      return handleUploadChunk(request, env, user.id)
    case '/upload/complete':
      return handleUploadComplete(request, env, user.id)
    case '/upload/status':
      return handleUploadStatus(request, env, user.id)
    case '/upload/delete':
      return handleUploadDelete(request, env, user.id)
    case '/stats':
      if (request.method !== 'GET')
        throw new WorkerError('Method Not Allowed', 'METHOD_NOT_ALLOWED', 405)
      return Response.json(await getUserUsage(env, user.id), {
        headers: { 'Cache-Control': 'no-store' }
      })
    default:
      throw new NotFoundError('Endpoint')
  }
}
const app = compose(withCORS, withErrorHandler, withLogging, withValidation)(handleRequest)
export default { fetch: (request: Request, env: Env): Promise<Response> => app(request, env) }
