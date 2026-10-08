import type { UploadedFileRef, UploadProgressCallback } from '../../types/task'
import { calculateFileMD5, DEFAULT_CHUNK_SIZE, validateUploadFile, type UploadPlan } from './file'
import { createUploadHTTP, UploadHTTPError, UploadTransportError } from './http'
import { captureSessionKey, createUploadSessions } from './sessions'
import { createProgressReporter } from './progress'

export interface UploadOptions {
  onProgress?: UploadProgressCallback
  chunkSize?: number
  apiUrl?: string
}

export async function uploadChunkedFile(
  file: File,
  options: UploadOptions = {}
): Promise<UploadedFileRef> {
  const chunkSize = options.chunkSize === undefined ? DEFAULT_CHUNK_SIZE : options.chunkSize
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function')
    throw new Error('Invalid onProgress')
  const totalChunks = validateUploadFile(file, chunkSize)
  const sessionKey = captureSessionKey()
  const assertAccount = () => {
    if (captureSessionKey() !== sessionKey) throw new Error('Account changed during upload')
  }
  const http = createUploadHTTP(options.apiUrl, assertAccount)
  const sessions = createUploadSessions(sessionKey)

  // Stage 1: hash incrementally; retain the existing resumable external ID.
  const fileHash = await calculateFileMD5(file, chunkSize)
  assertAccount()
  const plan: UploadPlan = {
    file,
    fileId: `${fileHash}-${file.size}`,
    fileHash,
    chunkSize,
    totalChunks
  }
  const progress = createProgressReporter(plan, options.onProgress)

  // Stage 2: only validated server state can skip a chunk.
  let received = (await http.status(plan)) ?? new Set<number>()
  function recordProgress() {
    assertAccount()
    sessions.save(plan, received)
    progress.report(received)
  }
  recordProgress()

  // Stage 3: send missing chunks sequentially, keeping memory bounded.
  async function uploadMissing() {
    for (let index = 0; index < totalChunks; index++) {
      if (received.has(index)) continue
      received = await http.chunk(plan, index)
      progress.transferred(index)
      recordProgress()
    }
  }
  await uploadMissing()

  // Stage 4: one bounded repair, only when fresh status proves missing chunks.
  let uploaded: UploadedFileRef
  try {
    uploaded = await http.complete(plan)
  } catch (error) {
    if (!(error instanceof UploadHTTPError) && !(error instanceof UploadTransportError)) throw error
    if (
      error instanceof UploadHTTPError &&
      (error.status === 401 ||
        error.status === 403 ||
        error.code === 'ACCOUNT_CHANGED' ||
        error.code === 'UPLOAD_METADATA_INVALID' ||
        error.code === 'UPLOAD_METADATA_CONFLICT' ||
        error.code === 'UPLOAD_SIZE_MISMATCH' ||
        error.code?.startsWith('FILE_'))
    )
      throw error
    const latest = await http.status(plan)
    if (!latest || latest.size === totalChunks) throw error
    received = latest
    recordProgress()
    await uploadMissing()
    uploaded = await http.complete(plan)
  }
  assertAccount()
  sessions.remove(plan.fileId)
  return uploaded
}
