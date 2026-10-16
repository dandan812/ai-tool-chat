import { WorkerError, type UploadedFileRef } from '../types'
import { MAX_UPLOAD_CHUNKS, MAX_UPLOAD_CHUNK_BYTES } from './uploadSchema'

export interface FileMetadata {
  fileId: string
  fileName: string
  fileHash: string
  totalSize: number
  totalChunks: number
  receivedChunks: number
  receivedIndices: number[]
  mimeType: string
  createdAt: number
  updatedAt: number
  isMerged?: boolean
  completedAt?: number
  receivedBytes?: number
  /** Optional for old uploads; new clients declare a fixed chunk layout. */
  chunkSize?: number
  /** Server-computed SHA-256; client fileHash remains the upload idempotency hint. */
  serverContentHash?: string
}

export interface StoredChunkEntry {
  index: number
  chunk: ArrayBuffer | null
}

export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export function assertFileMetadata(value: unknown, fileId: string): asserts value is FileMetadata {
  const fail = () => {
    throw new WorkerError(
      'Upload metadata is corrupt; no data was deleted',
      'UPLOAD_METADATA_INVALID',
      409
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const metadata = value as FileMetadata
  if (
    metadata.fileId !== fileId ||
    typeof metadata.fileName !== 'string' ||
    !metadata.fileName ||
    metadata.fileName.length > 255 ||
    typeof metadata.fileHash !== 'string' ||
    !metadata.fileHash ||
    metadata.fileHash.length > 128 ||
    typeof metadata.mimeType !== 'string' ||
    metadata.mimeType.length > 128 ||
    !Number.isSafeInteger(metadata.totalSize) ||
    metadata.totalSize < 1 ||
    metadata.totalSize > MAX_UPLOAD_CHUNKS * MAX_UPLOAD_CHUNK_BYTES ||
    !Number.isSafeInteger(metadata.totalChunks) ||
    metadata.totalChunks < 1 ||
    metadata.totalChunks > MAX_UPLOAD_CHUNKS ||
    metadata.totalChunks > metadata.totalSize ||
    !Array.isArray(metadata.receivedIndices) ||
    metadata.receivedIndices.some(
      (index) => !Number.isSafeInteger(index) || index < 0 || index >= metadata.totalChunks
    ) ||
    new Set(metadata.receivedIndices).size !== metadata.receivedIndices.length ||
    metadata.receivedChunks !== metadata.receivedIndices.length ||
    !Number.isSafeInteger(metadata.createdAt) ||
    metadata.createdAt < 1 ||
    !Number.isSafeInteger(metadata.updatedAt) ||
    metadata.updatedAt < 1
  )
    fail()
  if (
    metadata.receivedBytes !== undefined &&
    (!Number.isSafeInteger(metadata.receivedBytes) ||
      metadata.receivedBytes < 0 ||
      metadata.receivedBytes > metadata.totalSize)
  )
    fail()
  if (
    metadata.chunkSize !== undefined &&
    (!Number.isSafeInteger(metadata.chunkSize) ||
      metadata.chunkSize < 1 ||
      metadata.chunkSize > MAX_UPLOAD_CHUNK_BYTES ||
      Math.ceil(metadata.totalSize / metadata.chunkSize) !== metadata.totalChunks)
  )
    fail()
  if (metadata.isMerged !== undefined && typeof metadata.isMerged !== 'boolean') fail()
  if (
    metadata.serverContentHash !== undefined &&
    (typeof metadata.serverContentHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(metadata.serverContentHash))
  )
    fail()
}

export function createUploadedFileRef(metadata: FileMetadata): UploadedFileRef {
  return {
    fileId: metadata.fileId,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    size: metadata.totalSize,
    fileHash: metadata.fileHash,
    source: 'uploaded'
  }
}

export function isUploadExpired(metadata: FileMetadata): boolean {
  // Completed private documents remain available until their owner deletes them.
  if (metadata.isMerged) return false
  const lastUpdatedAt = metadata.updatedAt || metadata.createdAt
  return Date.now() - lastUpdatedAt > UPLOAD_TTL_MS
}

export function repairMetadataFromChunks(
  metadata: FileMetadata,
  entries: StoredChunkEntry[]
): {
  repairedMetadata: FileMetadata
  missingIndices: number[]
} {
  const receivedIndices = entries.filter((entry) => !!entry.chunk).map((entry) => entry.index)

  return {
    repairedMetadata: {
      ...metadata,
      receivedIndices,
      receivedChunks: receivedIndices.length,
      receivedBytes: entries.reduce((total, entry) => total + (entry.chunk?.byteLength || 0), 0),
      updatedAt: Date.now()
    },
    missingIndices: entries.filter((entry) => !entry.chunk).map((entry) => entry.index)
  }
}

export function mergeStoredChunks(totalSize: number, chunks: ArrayBuffer[]): Uint8Array {
  const actualSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  if (actualSize !== totalSize) {
    throw new WorkerError(
      'Actual file size does not match upload metadata',
      'UPLOAD_SIZE_MISMATCH',
      409
    )
  }
  const merged = new Uint8Array(totalSize)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }

  return merged
}
