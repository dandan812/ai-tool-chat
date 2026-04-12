import type { Env } from '../types';
import { logger } from '../infrastructure/logger';
import {
  getUploadedFileChunkObjectKey,
  getUploadedFileObjectKey,
  getUploadedFileTextIndexObjectKey,
} from './uploadedFileStorage';
import {
  createUploadedFileRef,
  type FileMetadata,
  isUploadExpired,
  repairMetadataFromChunks,
  UPLOAD_TTL_MS,
} from './chunkStorageSupport';

/**
 * 上传状态服务把“状态修复、分片合并、R2 正文操作”集中到一层，
 * Durable Object 本体只负责接 action 和返回响应。
 * 这样既保留了现有上传主链路，又把最难读的存储细节挪出了入口文件。
 */
export class ChunkStorageService {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async handleAction(action: string | null, request: Request, url: URL): Promise<Response> {
    switch (action) {
      case 'storeChunk':
        return this.handleStoreChunk(request);
      case 'getMetadata':
        return this.handleGetMetadata(url);
      case 'isComplete':
        return this.handleIsComplete(url);
      case 'mergeChunks':
        return this.handleMergeChunks(url);
      case 'deleteFile':
        return this.handleDeleteFile(url);
      case 'cleanup':
        return this.handleCleanup();
      default:
        return new Response('Unknown action', { status: 400 });
    }
  }

  private async handleStoreChunk(request: Request): Promise<Response> {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const fileName = (formData.get('fileName') as string) || '';
    const fileSize = Number.parseInt((formData.get('fileSize') as string) || '0', 10);
    const chunkIndex = Number.parseInt((formData.get('chunkIndex') as string) || '0', 10);
    const totalChunks = Number.parseInt((formData.get('totalChunks') as string) || '0', 10);
    const fileHash = formData.get('fileHash') as string;
    const chunk = formData.get('chunk') as File;
    const mimeType = (formData.get('mimeType') as string) || 'text/plain';

    if (!fileId || !chunk || Number.isNaN(chunkIndex)) {
      return this.jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const arrayBuffer = await chunk.arrayBuffer();
    const metadataKey = this.getMetadataKey(fileId);
    const currentTime = Date.now();

    let metadata = await this.state.storage.get<FileMetadata>(metadataKey);
    if (metadata && isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      metadata = undefined;
    }

    if (metadata?.receivedIndices.includes(chunkIndex)) {
      return this.jsonResponse({
        success: true,
        duplicate: true,
        chunkIndex,
        fileId,
        receivedChunks: metadata.receivedChunks,
        receivedIndices: metadata.receivedIndices,
      });
    }

    const chunkObjectKey = this.getChunkObjectKey(fileId, chunkIndex);
    const existingChunk = await this.env.UPLOADED_FILES.head(chunkObjectKey);
    if (existingChunk) {
      const deduplicatedIndices = metadata
        ? Array.from(new Set([...metadata.receivedIndices, chunkIndex])).sort((a, b) => a - b)
        : [chunkIndex];

      if (metadata) {
        metadata = {
          ...metadata,
          receivedChunks: deduplicatedIndices.length,
          receivedIndices: deduplicatedIndices,
          updatedAt: currentTime,
        };
        await this.state.storage.put(metadataKey, metadata);
      }

      return this.jsonResponse({
        success: true,
        duplicate: true,
        chunkIndex,
        fileId,
        receivedChunks: deduplicatedIndices.length,
        receivedIndices: deduplicatedIndices,
      });
    }

    if (!metadata) {
      metadata = {
        fileId,
        fileName,
        fileHash,
        totalSize: fileSize > 0 ? fileSize : arrayBuffer.byteLength,
        totalChunks: totalChunks > 0 ? totalChunks : 1,
        receivedChunks: 0,
        receivedIndices: [],
        mimeType,
        createdAt: currentTime,
        updatedAt: currentTime,
      };
    }

    const nextIndices = Array.from(new Set([...metadata.receivedIndices, chunkIndex])).sort((a, b) => a - b);
    const updatedMetadata: FileMetadata = {
      ...metadata,
      fileName: fileName || metadata.fileName,
      fileHash: fileHash || metadata.fileHash,
      totalSize: fileSize > 0 ? fileSize : metadata.totalSize,
      totalChunks: totalChunks > 0 ? totalChunks : metadata.totalChunks,
      mimeType,
      receivedChunks: nextIndices.length,
      receivedIndices: nextIndices,
      updatedAt: currentTime,
    };

    await this.state.storage.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);
    });
    await this.env.UPLOADED_FILES.put(chunkObjectKey, arrayBuffer, {
      httpMetadata: {
        contentType: 'application/octet-stream',
      },
      customMetadata: {
        fileId,
        chunkIndex: String(chunkIndex),
        fileHash: fileHash || '',
      },
    });

    return this.jsonResponse({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: updatedMetadata.receivedChunks,
      receivedIndices: updatedMetadata.receivedIndices,
    });
  }

  private async handleGetMetadata(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    if (!metadata) {
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    return this.jsonResponse(metadata);
  }

  private async handleIsComplete(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    if (!metadata) {
      return this.jsonResponse({ isComplete: false }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ isComplete: false }, 404);
    }

    return this.jsonResponse({
      isComplete: metadata.isMerged || metadata.receivedChunks >= metadata.totalChunks,
    });
  }

  /**
   * 合并前先基于真实分片修正 metadata，
   * 是为了防止前端/旧会话把“已收到的分片数”记错，导致直接在 merge 时炸掉。
   */
  private async handleMergeChunks(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadataKey = this.getMetadataKey(fileId);
    const metadata = await this.state.storage.get<FileMetadata>(metadataKey);
    if (!metadata) {
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    if (await this.hasUploadedFileObject(fileId)) {
      await this.markFileAsMerged(metadata);
      return this.jsonResponse({
        success: true,
        file: createUploadedFileRef(metadata),
      });
    }

    if (metadata.receivedChunks < metadata.totalChunks) {
      return this.jsonResponse({
        success: false,
        error: `Incomplete upload: ${metadata.receivedChunks}/${metadata.totalChunks} chunks received`,
      });
    }

    const chunkEntries = await this.loadStoredChunks(fileId, metadata.totalChunks);
    const { repairedMetadata, missingIndices } = repairMetadataFromChunks(metadata, chunkEntries);
    if (missingIndices.length > 0) {
      await this.state.storage.put(metadataKey, repairedMetadata);

      logger.warn('Missing chunks detected before merge', {
        fileId,
        missingIndices,
        receivedChunks: repairedMetadata.receivedChunks,
        totalChunks: repairedMetadata.totalChunks,
      });

      return this.jsonResponse({
        success: false,
        error: `Incomplete upload: ${repairedMetadata.receivedChunks}/${repairedMetadata.totalChunks} chunks received`,
      });
    }

    const updatedMetadata: FileMetadata = {
      ...metadata,
      isMerged: true,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.env.UPLOADED_FILES.put(this.getUploadedFileKey(fileId), this.createMergedChunkBody(fileId, metadata.totalSize, chunkEntries), {
      httpMetadata: {
        contentType: metadata.mimeType || 'text/plain',
      },
      customMetadata: {
        fileId: metadata.fileId,
        fileName: metadata.fileName,
        fileHash: metadata.fileHash,
      },
    });

    await this.state.storage.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);
    });
    await this.deleteChunkObjects(fileId, metadata.totalChunks);

    return this.jsonResponse({
      success: true,
      file: createUploadedFileRef(updatedMetadata),
    });
  }

  private async handleDeleteFile(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    if (metadata) {
      await this.deleteFileData(metadata);
    }

    return this.jsonResponse({ success: true });
  }

  private async handleCleanup(): Promise<Response> {
    const files = await this.state.storage.list<FileMetadata>({ prefix: 'meta:' });
    const currentTime = Date.now();
    const expiredFiles: FileMetadata[] = [];

    for (const [, metadata] of files) {
      const lastUpdatedAt = metadata.updatedAt || metadata.createdAt;
      if (currentTime - lastUpdatedAt > UPLOAD_TTL_MS) {
        expiredFiles.push(metadata);
      }
    }

    for (const metadata of expiredFiles) {
      await this.deleteFileData(metadata);
    }

    return this.jsonResponse({ deletedCount: expiredFiles.length });
  }

  private getMetadataKey(fileId: string): string {
    return `meta:${fileId}`;
  }

  private getUploadedFileKey(fileId: string): string {
    return getUploadedFileObjectKey(fileId);
  }

  private async deleteFileData(metadata: FileMetadata): Promise<void> {
    await this.state.storage.transaction(async (txn) => {
      await txn.delete(this.getMetadataKey(metadata.fileId));
    });

    await this.deleteChunkObjects(metadata.fileId, metadata.totalChunks);
    await this.env.UPLOADED_FILES.delete(this.getUploadedFileKey(metadata.fileId));
    await this.env.UPLOADED_FILES.delete(getUploadedFileTextIndexObjectKey(metadata.fileId));
  }

  private async hasUploadedFileObject(fileId: string): Promise<boolean> {
    const object = await this.env.UPLOADED_FILES.head(this.getUploadedFileKey(fileId));
    return object !== null;
  }

  private async markFileAsMerged(metadata: FileMetadata): Promise<void> {
    if (metadata.isMerged) {
      return;
    }

    const updatedMetadata: FileMetadata = {
      ...metadata,
      isMerged: true,
      completedAt: metadata.completedAt || Date.now(),
      updatedAt: Date.now(),
    };

    await this.state.storage.transaction(async (txn) => {
      await txn.put(this.getMetadataKey(metadata.fileId), updatedMetadata);
    });
    await this.deleteChunkObjects(metadata.fileId, metadata.totalChunks);
  }

  private async loadStoredChunks(fileId: string, totalChunks: number): Promise<Array<{ index: number; chunk: ArrayBuffer | null }>> {
    const entries: Array<{ index: number; chunk: ArrayBuffer | null }> = [];

    for (let index = 0; index < totalChunks; index++) {
      const chunkObject = await this.env.UPLOADED_FILES.get(this.getChunkObjectKey(fileId, index));
      const chunk = chunkObject ? await chunkObject.arrayBuffer() : null;
      entries.push({
        index,
        chunk: chunk ?? null,
      });
    }

    return entries;
  }

  private getChunkObjectKey(fileId: string, chunkIndex: number): string {
    return getUploadedFileChunkObjectKey(fileId, chunkIndex);
  }

  private async deleteChunkObjects(fileId: string, totalChunks: number): Promise<void> {
    for (let index = 0; index < totalChunks; index++) {
      await this.env.UPLOADED_FILES.delete(this.getChunkObjectKey(fileId, index));
    }
  }

  private createMergedChunkBody(
    fileId: string,
    totalSize: number,
    chunkEntries: Array<{ index: number; chunk: ArrayBuffer | null }>,
  ): ReadableStream<Uint8Array> {
    const FixedLengthStreamCtor = (globalThis as typeof globalThis & {
      FixedLengthStream?: new (length: number) => {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
      };
    }).FixedLengthStream;

    if (!FixedLengthStreamCtor) {
      return this.createMergedChunkFallbackStream(fileId, chunkEntries);
    }

    const fixedLengthStream = new FixedLengthStreamCtor(totalSize);

    // 使用固定长度流把各个 R2 分片顺序转发给最终对象，避免在 DO 内拼出大 Blob。
    void this.pipeChunksToFixedLengthStream(fileId, chunkEntries, fixedLengthStream.writable);

    return fixedLengthStream.readable;
  }

  private createMergedChunkFallbackStream(
    fileId: string,
    chunkEntries: Array<{ index: number; chunk: ArrayBuffer | null }>,
  ): ReadableStream<Uint8Array> {
    const iterator = chunkEntries[Symbol.iterator]();

    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const next = iterator.next();
        if (next.done) {
          controller.close();
          return;
        }

        const { index } = next.value;
        const object = await this.env.UPLOADED_FILES.get(this.getChunkObjectKey(fileId, index));
        if (!object) {
          throw new Error(`Missing chunk object: ${index}`);
        }

        controller.enqueue(new Uint8Array(await object.arrayBuffer()));
      },
    });
  }

  private async pipeChunksToFixedLengthStream(
    fileId: string,
    chunkEntries: Array<{ index: number; chunk: ArrayBuffer | null }>,
    writable: WritableStream<Uint8Array>,
  ): Promise<void> {
    const writer = writable.getWriter();

    try {
      for (const { index } of chunkEntries) {
        const object = await this.env.UPLOADED_FILES.get(this.getChunkObjectKey(fileId, index));
        if (!object) {
          throw new Error(`Missing chunk object: ${index}`);
        }

        await writer.write(new Uint8Array(await object.arrayBuffer()));
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error);
      throw error;
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
