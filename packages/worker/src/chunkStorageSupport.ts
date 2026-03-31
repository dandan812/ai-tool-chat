import type { UploadedFileRef } from './types';

export interface FileMetadata {
  fileId: string;
  fileName: string;
  fileHash: string;
  totalSize: number;
  totalChunks: number;
  receivedChunks: number;
  receivedIndices: number[];
  mimeType: string;
  createdAt: number;
  updatedAt: number;
  isMerged?: boolean;
  completedAt?: number;
}

export interface StoredChunkEntry {
  index: number;
  chunk: ArrayBuffer | null;
}

export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export function createUploadedFileRef(metadata: FileMetadata): UploadedFileRef {
  return {
    fileId: metadata.fileId,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    size: metadata.totalSize,
    fileHash: metadata.fileHash,
    source: 'uploaded',
  };
}

export function isUploadExpired(metadata: FileMetadata): boolean {
  const lastUpdatedAt = metadata.updatedAt || metadata.createdAt;
  return Date.now() - lastUpdatedAt > UPLOAD_TTL_MS;
}

export function repairMetadataFromChunks(
  metadata: FileMetadata,
  entries: StoredChunkEntry[],
): {
  repairedMetadata: FileMetadata;
  missingIndices: number[];
} {
  const receivedIndices = entries
    .filter((entry) => !!entry.chunk)
    .map((entry) => entry.index);

  return {
    repairedMetadata: {
      ...metadata,
      receivedIndices,
      receivedChunks: receivedIndices.length,
      updatedAt: Date.now(),
    },
    missingIndices: entries
      .filter((entry) => !entry.chunk)
      .map((entry) => entry.index),
  };
}

export function mergeStoredChunks(totalSize: number, chunks: ArrayBuffer[]): Uint8Array {
  const merged = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return merged;
}
