import type { Env, ResolvedFileContent, UploadedFileRef } from '../types';
import { ValidationError, WorkerError } from '../types';
import { createErrorDetails, ERROR_CODES } from './observability';

export function getChunkStorageStub(env: Env, fileId: string) {
  const id = env.CHUNK_STORAGE.idFromName(fileId);
  return env.CHUNK_STORAGE.get(id);
}

export function createChunkStorageUrl(path: string): string {
  return `https://chunk-storage${path}`;
}

export function getUploadedFileObjectKey(fileId: string): string {
  return `uploaded-files/${fileId}`;
}

export function getUploadedFileChunkObjectKey(fileId: string, chunkIndex: number): string {
  return `uploaded-file-chunks/${fileId}/${chunkIndex}`;
}

export function getUploadedFileTextIndexObjectKey(fileId: string): string {
  return `uploaded-file-indices/${fileId}.json`;
}

export async function getUploadedFileContent(
  env: Env,
  file: UploadedFileRef
): Promise<ResolvedFileContent> {
  const object = await env.UPLOADED_FILES.get(getUploadedFileObjectKey(file.fileId));
  if (!object) {
    throw new WorkerError(
      `Uploaded file ${file.fileId} not found`,
      ERROR_CODES.UPLOADED_FILE_NOT_FOUND,
      404,
      {
        fileId: file.fileId,
        fileName: file.fileName,
      },
    );
  }

  try {
    const content = await object.text();
    return {
      ...file,
      content,
    };
  } catch (error) {
    throw new ValidationError(
      `读取上传文件失败: ${String(error)}`,
      createErrorDetails(ERROR_CODES.UPLOADED_FILE_READ_FAILED, {
        fileId: file.fileId,
        fileName: file.fileName,
      }),
    );
  }
}
