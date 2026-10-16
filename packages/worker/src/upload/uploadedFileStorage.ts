import type { Env, ResolvedFileContent, UploadedFileRef } from '../types'
import { ValidationError, WorkerError } from '../types'
import { createErrorDetails, ERROR_CODES } from '../infrastructure/observability'
import { getDocumentFormat } from './documentFormat'
export { resolveOwnedUploadedFiles } from './ownedFiles'

export function getChunkStorageStub(env: Env, fileId: string) {
  const id = env.CHUNK_STORAGE.idFromName(fileId)
  return env.CHUNK_STORAGE.get(id)
}

export function createChunkStorageUrl(path: string): string {
  return `https://chunk-storage${path}`
}

export function getUploadedFileObjectKey(fileId: string): string {
  return `uploaded-files/${fileId}`
}

export function getUploadedFileChunkObjectKey(fileId: string, chunkIndex: number): string {
  return `uploaded-file-chunks/${fileId}/${chunkIndex}`
}

export function getUploadedFileTextIndexObjectKey(fileId: string): string {
  return `uploaded-file-indices/${fileId}.json`
}

export async function getUploadedFileContent(
  env: Env,
  file: UploadedFileRef
): Promise<ResolvedFileContent> {
  const object = await env.UPLOADED_FILES.get(getUploadedFileObjectKey(file.fileId))
  if (!object) {
    throw new WorkerError(
      `Uploaded file ${file.fileId} not found`,
      ERROR_CODES.UPLOADED_FILE_NOT_FOUND,
      404,
      {
        fileId: file.fileId,
        fileName: file.fileName
      }
    )
  }

  if (
    !/^[a-f0-9]{64}$/.test(file.fileHash) ||
    object.customMetadata?.serverContentHash !== file.fileHash
  ) {
    throw new WorkerError(
      'File version changed or is unverified; please upload and create a new task',
      'FILE_VERSION_CHANGED',
      410
    )
  }
  try {
    const signal = env.RUNTIME_CONTROL?.signal
    signal?.throwIfAborted()
    let content: string
    if (getDocumentFormat(file)) {
      if (!env.EXTRACT_DOCUMENT_TEXT) {
        throw new WorkerError(
          '当前服务尚未启用 PDF、Word、Excel 解析，请联系管理员。',
          'DOCUMENT_PARSER_UNAVAILABLE',
          503
        )
      }
      content = await env.EXTRACT_DOCUMENT_TEXT(
        new Uint8Array(await object.arrayBuffer()),
        file,
        signal
      )
    } else {
      content = await object.text()
    }
    signal?.throwIfAborted()
    return {
      ...file,
      content
    }
  } catch (error) {
    if (error instanceof WorkerError || env.RUNTIME_CONTROL?.signal.aborted) throw error
    throw new ValidationError(
      `读取上传文件失败: ${String(error)}`,
      createErrorDetails(ERROR_CODES.UPLOADED_FILE_READ_FAILED, {
        fileId: file.fileId,
        fileName: file.fileName
      })
    )
  }
}
