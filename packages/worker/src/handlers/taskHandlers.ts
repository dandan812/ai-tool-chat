import type { ChatRequest, Env, ImageData, Message, UploadedFileRef } from '../types'
import { WorkerError } from '../types'
import { digest, listUserTasks } from '../platform/accounts'
import { resolveOwnedUploadedFiles } from '../upload/ownedFiles'
import {
  resolveDefaultFileModel,
  resolveDefaultMultimodalModel,
  resolveDefaultTextModel
} from '../model/textModel'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024
function invalid(message: string, status = 400): never {
  throw new WorkerError(message, 'TASK_INVALID_REQUEST', status)
}

/** Consume the actual stream under a hard limit; Content-Length is not trustworthy. */
export async function readTaskJSON(request: Request): Promise<unknown> {
  if (!request.body) invalid('Request body is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel()
        invalid('Request body is too large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))
  } catch {
    invalid('Invalid JSON body')
  }
}

export function validateTaskBody(input: unknown, env: Env): ChatRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Invalid request')
  const body = input as Record<string, unknown>
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 32)
    invalid('Provide 1–32 messages')
  let contentLength = 0
  const messages: Message[] = body.messages.map((value) => {
    if (!value || typeof value !== 'object') invalid('Invalid message')
    const item = value as Record<string, unknown>
    if (
      !['user', 'assistant', 'system'].includes(String(item.role)) ||
      typeof item.content !== 'string'
    )
      invalid('Invalid message role or content')
    contentLength += item.content.length
    return { role: item.role as Message['role'], content: item.content }
  })
  if (contentLength > 32000 || messages.at(-1)?.role !== 'user' || !messages.at(-1)?.content.trim())
    invalid('Invalid or oversized conversation')
  const temperature = body.temperature ?? 0.7
  if (
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  )
    invalid('Invalid temperature')
  const maxTokens = body.maxTokens ?? 2000
  if (
    typeof maxTokens !== 'number' ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > 4096
  )
    invalid('Output limit must be 1–4096 tokens')
  if (body.enableTools !== undefined && typeof body.enableTools !== 'boolean')
    invalid('Invalid tool option')
  const result: ChatRequest = {
    messages,
    temperature,
    maxTokens,
    enableTools: body.enableTools === true
  }
  if (body.model !== undefined) {
    const allowed = [
      resolveDefaultTextModel(env),
      resolveDefaultFileModel(env),
      resolveDefaultMultimodalModel(env)
    ]
    if (typeof body.model !== 'string' || !allowed.includes(body.model))
      invalid('Model is not enabled by the administrator')
    result.model = body.model
  }
  if (body.images !== undefined) {
    if (!Array.isArray(body.images) || body.images.length > 4)
      invalid('At most four images are allowed')
    result.images = body.images.map((value): ImageData => {
      if (!value || typeof value !== 'object') invalid('Invalid image')
      const image = value as Record<string, unknown>
      if (
        typeof image.id !== 'string' ||
        image.id.length > 128 ||
        typeof image.base64 !== 'string' ||
        image.base64.length > 1800000 ||
        !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(image.mimeType)) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64) ||
        image.base64.length < 4
      )
        invalid('Invalid image data')
      return { id: image.id, base64: image.base64, mimeType: image.mimeType as string }
    })
  }
  if (body.files !== undefined) {
    if (!Array.isArray(body.files) || body.files.length > 5)
      invalid('At most five files are allowed')
    result.files = body.files.map((value): UploadedFileRef => {
      if (!value || typeof value !== 'object') invalid('Invalid file reference')
      const file = value as Record<string, unknown>
      if (
        typeof file.fileId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(file.fileId) ||
        typeof file.fileName !== 'string' ||
        file.fileName.length > 255 ||
        typeof file.mimeType !== 'string' ||
        file.mimeType.length > 128 ||
        typeof file.fileHash !== 'string' ||
        file.fileHash.length > 128 ||
        typeof file.size !== 'number' ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.source !== 'uploaded'
      )
        invalid('Invalid file reference')
      return {
        fileId: file.fileId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileHash: file.fileHash,
        size: file.size,
        source: 'uploaded'
      }
    })
  }
  if (result.enableTools && (!result.files?.length || result.images?.length))
    invalid('资料研究需要文件附件，图片与文件联合问答请关闭资料研究')
  return result
}

export async function handleTaskRequest(
  request: Request,
  env: Env,
  user: { id: string; username: string }
): Promise<Response> {
  if (!env.TASKS || !env.ACCOUNTS)
    throw new WorkerError('Task service is not configured', 'TASK_UNAVAILABLE', 503)
  const url = new URL(request.url)
  if (url.pathname === '/tasks' && request.method === 'GET') {
    return Response.json(
      { tasks: await listUserTasks(env, user.id) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }
  if (url.pathname === '/tasks' && request.method === 'POST') {
    const key = request.headers.get('Idempotency-Key')
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      invalid('A 16–128 character Idempotency-Key is required')
    const body = validateTaskBody(await readTaskJSON(request), env)
    const clientRequestHash = await digest(JSON.stringify(body))
    const taskId = await digest(`${user.id}:${key}`)
    const stub = env.TASKS.get(env.TASKS.idFromName(taskId))
    const replay = () =>
      stub.fetch(
        new Request('https://task/replay', {
          method: 'POST',
          headers: { 'X-Task-Owner': user.id, 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientRequestHash })
        })
      )
    const existing = await replay()
    if (existing.status !== 404) return existing
    if (body.files?.length) {
      try {
        body.files = await resolveOwnedUploadedFiles(env, user.id, body.files)
      } catch (error) {
        // A concurrent first creation may have won while the original file was deleted.
        const concurrent = await replay()
        if (concurrent.status !== 404) return concurrent
        throw error
      }
    }
    const requestHash = await digest(JSON.stringify(body))
    return stub.fetch(
      new Request('https://task/create', {
        method: 'POST',
        headers: { 'X-Task-Owner': user.id, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          taskId,
          requestHash,
          clientRequestHash,
          request: body
        })
      })
    )
  }
  const match = /^\/tasks\/([a-f0-9]{64})(?:\/(events|cancel))?$/.exec(url.pathname)
  if (!match || (match[2] === 'cancel' ? request.method !== 'POST' : request.method !== 'GET')) {
    throw new WorkerError('Task not found', 'NOT_FOUND', 404)
  }
  const target = new URL(`https://task/${match[2] || ''}`)
  if (match[2] === 'events') target.searchParams.set('after', url.searchParams.get('after') || '0')
  return env.TASKS.get(env.TASKS.idFromName(match[1])).fetch(
    new Request(target, {
      method: request.method,
      headers: {
        'X-Task-Owner': user.id,
        Accept: request.headers.get('Accept') || 'application/json'
      },
      signal: request.signal
    })
  )
}
