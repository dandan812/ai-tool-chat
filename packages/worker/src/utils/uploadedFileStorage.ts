import type { Env, ResolvedFileContent, UploadedFileRef } from '../types';
import { NotFoundError, ValidationError } from '../types';

export function getChunkStorageStub(env: Env, fileId: string) {
  const id = env.CHUNK_STORAGE.idFromName(fileId);
  return env.CHUNK_STORAGE.get(id);
}

export function createChunkStorageUrl(path: string): string {
  return `https://chunk-storage${path}`;
}

export async function getUploadedFileContent(
  env: Env,
  file: UploadedFileRef
): Promise<ResolvedFileContent> {
  const chunkStorage = getChunkStorageStub(env, file.fileId);
  const response = await chunkStorage.fetch(
    createChunkStorageUrl(`/?action=getFileContent&fileId=${encodeURIComponent(file.fileId)}`)
  );

  if (response.status === 404) {
    throw new NotFoundError(`Uploaded file ${file.fileId}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new ValidationError(`读取上传文件失败: ${errorText}`);
  }

  return response.json() as Promise<ResolvedFileContent>;
}
