/**
 * 分片管理器 - 文件分片上传核心逻辑
 *
 * 功能：
 * - 存储文件分片到内存
 * - 跟踪上传进度
 * - 合并分片为完整文件
 * - 自动清理过期分片
 *
 * @package worker/src/utils
 */

import type { FileData } from '../types';
import { logger } from './logger';

/**
 * 分片元数据
 */
interface ChunkMetadata {
  fileName: string;
  fileHash: string;
  totalSize: number;
  totalChunks: number;
  receivedChunks: number;
  receivedIndices: number[];
  mimeType: string;
  createdAt: number;
}

/**
 * 分片管理器配置
 */
const CHUNK_TIMEOUT = 5 * 60 * 1000; // 5 分钟后清理未完成的分片

/**
 * 分片管理器类
 *
 * 使用内存存储分片数据，适配 Cloudflare Workers 无状态限制
 */
export class ChunkManager {
  // fileId -> Map<chunkIndex, ArrayBuffer>
  private chunks = new Map<string, Map<number, ArrayBuffer>>();

  // fileId -> ChunkMetadata
  private metadata = new Map<string, ChunkMetadata>();

  /**
   * 存储单个分片
   */
  storeChunk(fileId: string, chunkIndex: number, data: ArrayBuffer): boolean {
    try {
      // 初始化分片存储
      if (!this.chunks.has(fileId)) {
        this.chunks.set(fileId, new Map());
      }

      const fileChunks = this.chunks.get(fileId)!;
      fileChunks.set(chunkIndex, data);

      // 更新元数据
      this.updateMetadata(fileId, {
        receivedChunks: this.getReceivedCount(fileId) + 1,
        receivedIndices: this.getReceivedIndices(fileId).concat(chunkIndex),
      });

      logger.debug('Chunk stored', { fileId, chunkIndex, size: data.byteLength });
      return true;
    } catch (error) {
      logger.error('Failed to store chunk', { fileId, chunkIndex, error });
      return false;
    }
  }

  /**
   * 更新或初始化元数据
   */
  updateMetadata(fileId: string, data: Partial<ChunkMetadata> & { createdAt?: number }): void {
    const current = this.metadata.get(fileId);

    if (current) {
      // 更新现有元数据
      this.metadata.set(fileId, { ...current, ...data });
    } else {
      // 初始化新元数据
      this.metadata.set(fileId, {
        fileName: data.fileName || '',
        fileHash: data.fileHash || '',
        totalSize: data.totalSize || 0,
        totalChunks: data.totalChunks || 0,
        receivedChunks: data.receivedChunks || 0,
        receivedIndices: data.receivedIndices || [],
        mimeType: data.mimeType || 'text/plain',
        createdAt: data.createdAt || Date.now(),
      });
    }
  }

  /**
   * 检查是否所有分片都已上传
   */
  isComplete(fileId: string): boolean {
    const meta = this.metadata.get(fileId);
    if (!meta) return false;

    // 检查是否达到总片数
    if (meta.receivedChunks < meta.totalChunks) {
      return false;
    }

    // 检查所有分片索引是否存在
    const fileChunks = this.chunks.get(fileId);
    if (!fileChunks || fileChunks.size < meta.totalChunks) {
      return false;
    }

    return true;
  }

  /**
   * 合并所有分片为完整文件
   */
  mergeChunks(fileId: string): ArrayBuffer {
    const meta = this.metadata.get(fileId);
    const chunksMap = this.chunks.get(fileId);

    if (!meta || !chunksMap) {
      throw new Error(`File ${fileId} not found`);
    }

    if (!this.isComplete(fileId)) {
      throw new Error(`File ${fileId} is not complete`);
    }

    logger.info('Merging chunks', {
      fileId,
      fileName: meta.fileName,
      totalChunks: meta.totalChunks,
      totalSize: meta.totalSize,
    });

    // 创建合并后的 ArrayBuffer
    const merged = new Uint8Array(meta.totalSize);
    let offset = 0;

    // 按顺序合并分片
    for (let i = 0; i < meta.totalChunks; i++) {
      const chunk = chunksMap.get(i);

      if (!chunk) {
        throw new Error(`Chunk ${i} missing for file ${fileId}`);
      }

      const chunkData = new Uint8Array(chunk);
      merged.set(chunkData, offset);
      offset += chunk.byteLength;
    }

    logger.info('Chunks merged successfully', {
      fileId,
      finalSize: merged.byteLength,
      expectedSize: meta.totalSize,
    });

    return merged.buffer;
  }

  /**
   * 获取已接收的分片索引列表
   */
  getReceivedIndices(fileId: string): number[] {
    const chunksMap = this.chunks.get(fileId);
    return chunksMap ? Array.from(chunksMap.keys()).sort((a, b) => a - b) : [];
  }

  /**
   * 获取已接收的分片数量
   */
  getReceivedCount(fileId: string): number {
    return this.getReceivedIndices(fileId).length;
  }

  /**
   * 获取文件元数据
   */
  getMetadata(fileId: string): ChunkMetadata | undefined {
    return this.metadata.get(fileId);
  }

  /**
   * 清理指定文件或所有过期分片
   */
  cleanup(fileId?: string): void {
    const now = Date.now();

    if (fileId) {
      // 清理指定文件
      this.chunks.delete(fileId);
      this.metadata.delete(fileId);
      logger.debug('Cleaned up file', { fileId });
    } else {
      // 清理所有过期分片
      const expiredFileIds: string[] = [];

      for (const [fid, meta] of this.metadata.entries()) {
        if (now - meta.createdAt > CHUNK_TIMEOUT) {
          expiredFileIds.push(fid);
        }
      }

      for (const expiredId of expiredFileIds) {
        this.chunks.delete(expiredId);
        this.metadata.delete(expiredId);
      }

      if (expiredFileIds.length > 0) {
        logger.info('Cleaned up expired chunks', { count: expiredFileIds.length });
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    activeFiles: number;
    totalChunks: number;
    totalBytes: number;
  } {
    let totalChunks = 0;
    let totalBytes = 0;

    for (const [fileId, meta] of this.metadata.entries()) {
      totalChunks += meta.totalChunks;
      totalBytes += meta.totalSize;
    }

    return {
      activeFiles: this.metadata.size,
      totalChunks,
      totalBytes,
    };
  }
}

/**
 * 导出单例
 */
export const chunkManager = new ChunkManager();

