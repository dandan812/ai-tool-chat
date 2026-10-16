import type { Env } from '../types'
import { createJSONResponse } from '../infrastructure/middleware'
import { parseChunkRequest, parseCompleteRequest, parseUploadFileId } from '../upload/uploadSchema'
import { UploadService } from '../upload/uploadService'
import { accountError, validateWriteOrigin } from '../platform/accounts'
export { resolveOwnedUploadedFiles } from '../upload/ownedFiles'
function checkMethod(request: Request, env: Env, method: 'GET' | 'POST'): void {
  if (request.method !== method) accountError('Method not allowed', 'METHOD_NOT_ALLOWED', 405)
  if (method === 'POST') validateWriteOrigin(request, env)
}

export async function handleUploadChunk(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  checkMethod(request, env, 'POST')
  const input = await parseChunkRequest(request, env)
  return createJSONResponse(await new UploadService(env, userId).chunk(input))
}

export async function handleUploadComplete(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  checkMethod(request, env, 'POST')
  const input = await parseCompleteRequest(request)
  return createJSONResponse(await new UploadService(env, userId).complete(input))
}

export async function handleUploadStatus(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  checkMethod(request, env, 'GET')
  const params = new URL(request.url).searchParams
  const fileId = parseUploadFileId(params.get('fileId'))
  const status = await new UploadService(env, userId).status(
    fileId,
    params.get('chunkSize') ?? undefined
  )
  return status
    ? createJSONResponse(status)
    : createJSONResponse({ error: 'File not found', code: 'UPLOAD_STATUS_NOT_FOUND' }, 404)
}

export async function handleUploadDelete(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  checkMethod(request, env, 'POST')
  const fileId = parseUploadFileId(new URL(request.url).searchParams.get('fileId'))
  return createJSONResponse(await new UploadService(env, userId).delete(fileId))
}
