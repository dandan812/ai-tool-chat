export const DEFAULT_CHUNK_SIZE = 100 * 1024
export const MAX_CHUNK_SIZE = 5 * 1024 * 1024
export const MAX_CHUNKS = 256

export function validateChunkSize(chunkSize: number): void {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
    throw new Error('chunkSize must be an integer between 1 and 5242880 bytes')
  }
}

export function validateUploadFile(file: File, chunkSize: number): number {
  validateChunkSize(chunkSize)
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    !file.name ||
    file.name.length > 255 ||
    file.type.length > 128
  ) {
    throw new Error('Invalid file size, name or MIME type')
  }
  const totalChunks = Math.ceil(file.size / chunkSize)
  if (totalChunks > MAX_CHUNKS)
    throw new Error('Upload exceeds 256 chunks; choose a larger chunkSize')
  return totalChunks
}

export async function calculateFileMD5(
  file: File,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<string> {
  validateChunkSize(chunkSize)
  const SparkMD5 = await import('spark-md5')
  const spark = new SparkMD5.ArrayBuffer()
  for (let start = 0; start < file.size; start += chunkSize) {
    spark.append(await file.slice(start, Math.min(start + chunkSize, file.size)).arrayBuffer())
  }
  return spark.end()
}

export interface UploadPlan {
  file: File
  fileId: string
  fileHash: string
  chunkSize: number
  totalChunks: number
}

export function chunkBytes(plan: UploadPlan, index: number): number {
  return Math.min(plan.chunkSize, plan.file.size - index * plan.chunkSize)
}
