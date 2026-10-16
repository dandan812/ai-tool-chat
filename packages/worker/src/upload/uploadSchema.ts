import { WorkerError, type Env } from '../types'
import { positive } from '../platform/accounts'

export const MAX_UPLOAD_CHUNKS = 256
export const MAX_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024

export function uploadInvalid(message: string): never {
  throw new WorkerError(message, 'UPLOAD_INVALID_REQUEST', 400)
}

export function parseUploadFileId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) {
    uploadInvalid('Invalid file ID')
  }
  return value
}

export interface ChunkInput {
  formData: FormData
  fileId: string
  fileName: string
  fileSize: number
  fileHash: string
  mimeType: string
  chunkIndex: number
  totalChunks: number
  chunkSize?: number
  chunk: File
}

function text(form: FormData, key: string): string {
  const values = form.getAll(key)
  if (values.length !== 1 || typeof values[0] !== 'string') uploadInvalid(`Invalid ${key}`)
  return values[0]
}

function integer(form: FormData, key: string): number {
  const value = text(form, key)
  if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    uploadInvalid(`Invalid ${key}`)
  return Number(value)
}

export function parseChunkForm(formData: FormData, env: Env): ChunkInput {
  const fileId = parseUploadFileId(text(formData, 'fileId'))
  const fileName = text(formData, 'fileName')
  const fileHash = text(formData, 'fileHash')
  const mimeType = formData.has('mimeType')
    ? text(formData, 'mimeType') || 'text/plain'
    : 'text/plain'
  const fileSize = integer(formData, 'fileSize')
  const chunkIndex = integer(formData, 'chunkIndex')
  const totalChunks = integer(formData, 'totalChunks')
  const chunkSize = formData.has('chunkSize') ? integer(formData, 'chunkSize') : undefined
  const chunks = formData.getAll('chunk')
  const chunk = chunks[0] as string | File | undefined
  if (
    chunks.length !== 1 ||
    !chunk ||
    typeof chunk === 'string' ||
    typeof chunk.arrayBuffer !== 'function' ||
    !fileName.trim() ||
    fileName.length > 255 ||
    !fileHash ||
    fileHash.length > 128 ||
    mimeType.length > 128 ||
    fileSize < 1 ||
    fileSize > positive(env.MAX_FILE_BYTES, 20 * 1024 * 1024) ||
    totalChunks < 1 ||
    totalChunks > MAX_UPLOAD_CHUNKS ||
    totalChunks > fileSize ||
    chunkIndex >= totalChunks ||
    chunk.size < 1 ||
    chunk.size > MAX_UPLOAD_CHUNK_BYTES ||
    chunk.size > fileSize
  ) {
    uploadInvalid('Invalid upload bounds or metadata')
  }
  if (
    chunkSize !== undefined &&
    (chunkSize < 1 ||
      chunkSize > MAX_UPLOAD_CHUNK_BYTES ||
      Math.ceil(fileSize / chunkSize) !== totalChunks ||
      chunk.size !== Math.min(chunkSize, fileSize - chunkIndex * chunkSize))
  ) {
    uploadInvalid('Invalid chunk layout or byte length')
  }
  return {
    formData,
    fileId,
    fileName,
    fileSize,
    fileHash,
    mimeType,
    chunkIndex,
    totalChunks,
    chunkSize,
    chunk
  }
}

export async function parseChunkRequest(request: Request, env: Env): Promise<ChunkInput> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    uploadInvalid('Invalid multipart body')
  }
  return parseChunkForm(form, env)
}

export interface CompleteInput {
  fileId: string
  fileHash?: string
}

export async function parseCompleteRequest(request: Request): Promise<CompleteInput> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    uploadInvalid('Invalid JSON body')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    uploadInvalid('Invalid completion body')
  const body = value as Record<string, unknown>
  const fileId = parseUploadFileId(body.fileId)
  if (
    body.fileHash !== undefined &&
    (typeof body.fileHash !== 'string' || !body.fileHash || body.fileHash.length > 128)
  ) {
    uploadInvalid('Invalid fileHash')
  }
  for (const [key, max] of [
    ['fileName', 255],
    ['mimeType', 128]
  ] as const) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > max))
      uploadInvalid(`Invalid ${key}`)
  }
  // Names and MIME types in complete are compatibility hints, not authority.
  return { fileId, fileHash: body.fileHash as string | undefined }
}
