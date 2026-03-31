/**
 * ChunkStorage Durable Object - 持久化分片存储
 *
 * 说明：
 * - 每个 fileId 对应一个 Durable Object 实例
 * - 分片写入必须幂等，避免重复上传导致计数错误
 * - 上传完成后，合并后的文件正文会保存在同一个 DO 中
 * - 断点续传依赖 metadata 中的 receivedIndices 恢复缺失分片
 */
import type { Env, UploadedFileRef } from './types';
import { logger } from './utils/logger';

interface FileMetadata {
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
}

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export class ChunkStorage implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    logger.debug('ChunkStorage fetch', { action, url: url.href });

    try {
      switch (action) {
        case 'storeChunk':
          return await this.handleStoreChunk(request);
        case 'getMetadata':
          return await this.handleGetMetadata(url);
        case 'getFileContent':
          return await this.handleGetFileContent(url);
        case 'isComplete':
          return await this.handleIsComplete(url);
        case 'mergeChunks':
          return await this.handleMergeChunks(url);
        case 'deleteFile':
          return await this.handleDeleteFile(url);
        case 'cleanup':
          return await this.handleCleanup();
        default:
          return new Response('Unknown action', { status: 400 });
      }
    } catch (error) {
      logger.error('ChunkStorage error', { action, error });
      return this.jsonResponse({ error: String(error) }, 500);
    }
  }

  /**
   * 存储分片
   */
  private async handleStoreChunk(request: Request): Promise<Response> {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const fileName = formData.get('fileName') as string || '';
    const fileSize = parseInt(formData.get('fileSize') as string || '0');
    const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0');
    const totalChunks = parseInt(formData.get('totalChunks') as string || '0');
    const fileHash = formData.get('fileHash') as string;
    const chunk = formData.get('chunk') as File;
    const mimeType = formData.get('mimeType') as string || 'text/plain';

    if (!fileId || !chunk || isNaN(chunkIndex)) {
      return this.jsonResponse({ error: 'Missing required fields' }, 400);
    }

    const arrayBuffer = await chunk.arrayBuffer();
    const metadataKey = this.getMetadataKey(fileId);
    const chunkKey = this.getChunkKey(chunkIndex);
    const now = Date.now();

    let metadata = await this.state.storage.get<FileMetadata>(metadataKey);
    if (metadata && this.isExpired(metadata)) {
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

    const existingChunk = await this.state.storage.get<ArrayBuffer>(chunkKey);
    if (existingChunk) {
      const deduplicatedIndices = metadata
        ? Array.from(new Set([...metadata.receivedIndices, chunkIndex])).sort((a, b) => a - b)
        : [chunkIndex];

      if (metadata) {
        metadata = {
          ...metadata,
          receivedChunks: deduplicatedIndices.length,
          receivedIndices: deduplicatedIndices,
          updatedAt: now,
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
        createdAt: now,
        updatedAt: now,
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
      updatedAt: now,
    };

    await this.state.storage.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);
      await txn.put(chunkKey, arrayBuffer);
    });

    return this.jsonResponse({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: updatedMetadata.receivedChunks,
      receivedIndices: updatedMetadata.receivedIndices,
    });
  }

  /**
   * 获取分片元数据
   */
  private async handleGetMetadata(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    if (!metadata) {
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    if (this.isExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    return this.jsonResponse(metadata);
  }

  /**
   * 获取合并后的文件正文
   */
  private async handleGetFileContent(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    const content = await this.state.storage.get<string>(this.getContentKey(fileId));

    if (!metadata || content === undefined) {
      return this.jsonResponse({ error: 'Uploaded file not found' }, 404);
    }

    if (this.isExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: 'Uploaded file not found' }, 404);
    }

    return this.jsonResponse({
      fileId: metadata.fileId,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      size: metadata.totalSize,
      fileHash: metadata.fileHash,
      source: 'uploaded',
      content,
    });
  }

  /**
   * 检查是否上传完整
   */
  private async handleIsComplete(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadata = await this.state.storage.get<FileMetadata>(this.getMetadataKey(fileId));
    if (!metadata) {
      return this.jsonResponse({ isComplete: false }, 404);
    }

    if (this.isExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ isComplete: false }, 404);
    }

    return this.jsonResponse({
      isComplete: metadata.receivedChunks >= metadata.totalChunks,
    });
  }

  /**
   * 合并分片并持久化最终文件正文
   */
  private async handleMergeChunks(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return this.jsonResponse({ error: 'Missing fileId' }, 400);
    }

    const metadataKey = this.getMetadataKey(fileId);
    const contentKey = this.getContentKey(fileId);
    const metadata = await this.state.storage.get<FileMetadata>(metadataKey);

    if (!metadata) {
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    if (this.isExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: 'File not found' }, 404);
    }

    const existingContent = await this.state.storage.get<string>(contentKey);
    if (existingContent !== undefined) {
      return this.jsonResponse({
        success: true,
        file: this.createUploadedFileRef(metadata),
      });
    }

    if (metadata.receivedChunks < metadata.totalChunks) {
      return this.jsonResponse({
        success: false,
        error: `Incomplete upload: ${metadata.receivedChunks}/${metadata.totalChunks} chunks received`,
      });
    }

    const result = await this.state.storage.transaction(async (txn) => {
      const chunks: ArrayBuffer[] = [];

      for (let i = 0; i < metadata.totalChunks; i++) {
        const chunk = await txn.get<ArrayBuffer>(this.getChunkKey(i));
        if (!chunk) {
          return { success: false, error: `Chunk ${i} not found` };
        }
        chunks.push(chunk);
      }

      const merged = new Uint8Array(metadata.totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      const content = new TextDecoder().decode(merged);
      const updatedMetadata: FileMetadata = {
        ...metadata,
        updatedAt: Date.now(),
      };

      await txn.put(contentKey, content);
      await txn.put(metadataKey, updatedMetadata);

      for (let i = 0; i < metadata.totalChunks; i++) {
        await txn.delete(this.getChunkKey(i));
      }

      return {
        success: true,
        file: this.createUploadedFileRef(updatedMetadata),
      };
    });

    return this.jsonResponse(result);
  }

  /**
   * 删除指定文件的上传状态和正文
   */
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

  /**
   * 清理过期上传内容
   */
  private async handleCleanup(): Promise<Response> {
    const files = await this.state.storage.list<FileMetadata>({ prefix: 'meta:' });
    const now = Date.now();
    const expiredFiles: FileMetadata[] = [];

    for (const [, metadata] of files) {
      const lastUpdatedAt = metadata.updatedAt || metadata.createdAt;
      if (now - lastUpdatedAt > UPLOAD_TTL_MS) {
        expiredFiles.push(metadata);
      }
    }

    const result = await this.state.storage.transaction(async (txn) => {
      let deletedCount = 0;

      for (const metadata of expiredFiles) {
        for (let i = 0; i < metadata.totalChunks; i++) {
          await txn.delete(this.getChunkKey(i));
        }
        await txn.delete(this.getMetadataKey(metadata.fileId));
        await txn.delete(this.getContentKey(metadata.fileId));
        deletedCount++;
      }

      return { deletedCount };
    });

    return this.jsonResponse(result);
  }

  private createUploadedFileRef(metadata: FileMetadata): UploadedFileRef {
    return {
      fileId: metadata.fileId,
      fileName: metadata.fileName,
      mimeType: metadata.mimeType,
      size: metadata.totalSize,
      fileHash: metadata.fileHash,
      source: 'uploaded' as const,
    };
  }

  private getMetadataKey(fileId: string): string {
    return `meta:${fileId}`;
  }

  private getChunkKey(chunkIndex: number): string {
    return `chunk:${chunkIndex}`;
  }

  private getContentKey(fileId: string): string {
    return `content:${fileId}`;
  }

  private isExpired(metadata: FileMetadata): boolean {
    const lastUpdatedAt = metadata.updatedAt || metadata.createdAt;
    return Date.now() - lastUpdatedAt > UPLOAD_TTL_MS;
  }

  private async deleteFileData(metadata: FileMetadata): Promise<void> {
    await this.state.storage.transaction(async (txn) => {
      for (let i = 0; i < metadata.totalChunks; i++) {
        await txn.delete(this.getChunkKey(i));
      }
      await txn.delete(this.getMetadataKey(metadata.fileId));
      await txn.delete(this.getContentKey(metadata.fileId));
    });
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
