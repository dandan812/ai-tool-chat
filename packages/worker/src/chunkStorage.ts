/**
 * ChunkStorage - 全局内存存储（用于测试）
 *
 * 使用全局 Map 作为临时存储方案
 */

interface FileMetadata {
  fileName: string;
  fileHash: string;
  totalSize: number;
  totalChunks: number;
  receivedChunks: number;
  receivedIndices: number[];
  mimeType: string;
  createdAt: number;
}

// 全局分片存储：fileId -> Map<chunkIndex, string (Base64)>
const chunksMap = new Map<string, Map<number, string>>();

// 全局元数据存储：fileId -> FileMetadata
const metadataMap = new Map<string, FileMetadata>();

export class ChunkStorage {
  constructor() {}

  /**
   * 存储分片
   */
  async storeChunk(
    fileId: string,
    chunkIndex: number,
    data: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 初始化文件分片存储
      if (!chunksMap.has(fileId)) {
        chunksMap.set(fileId, new Map());
      }

      const fileChunks = chunksMap.get(fileId)!;
      fileChunks.set(chunkIndex, data);

      // 更新元数据
      const existingMeta = metadataMap.get(fileId);
      const currentCount = existingMeta?.receivedChunks || 0;
      const currentIndices = existingMeta?.receivedIndices || [];

      const metadata: FileMetadata = {
        fileName: existingMeta?.fileName || '',
        fileHash: existingMeta?.fileHash || '',
        totalSize: existingMeta?.totalSize || data.length,
        totalChunks: existingMeta?.totalChunks || 1,
        receivedChunks: currentCount + 1,
        receivedIndices: [...currentIndices, chunkIndex],
        mimeType: existingMeta?.mimeType || 'text/plain',
        createdAt: existingMeta?.createdAt || Date.now(),
      };

      metadataMap.set(fileId, metadata);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 获取元数据
   */
  async getMetadata(fileId: string): Promise<FileMetadata | null> {
    return metadataMap.get(fileId) || null;
  }

  /**
   * 设置元数据
   */
  async setMetadata(fileId: string, metadata: FileMetadata): Promise<void> {
    metadataMap.set(fileId, metadata);
  }

  /**
   * 检查是否完整
   */
  async isComplete(fileId: string): Promise<boolean> {
    const metadata = await this.getMetadata(fileId);
    if (!metadata) return false;
    return metadata.receivedChunks >= metadata.totalChunks;
  }

  /**
   * 合并分片
   */
  async mergeChunks(fileId: string): Promise<{ success: boolean; data?: string; size?: number; error?: string }> {
    try {
      const metadata = await this.getMetadata(fileId);
      if (!metadata) {
        return { success: false, error: 'File not found' };
      }

      const { totalChunks } = metadata;
      const fileChunks = chunksMap.get(fileId);

      if (!fileChunks) {
        return { success: false, error: 'No chunks found' };
      }

      // 收集所有分片并合并
      const chunks: string[] = [];
      let totalSize = 0;

      for (let i = 0; i < totalChunks; i++) {
        const chunk = fileChunks.get(i);
        if (!chunk) {
          return { success: false, error: `Chunk ${i} not found` };
        }
        chunks.push(chunk);
        totalSize += chunk.length;
      }

      // 合并所有分片
      const merged = chunks.join('');

      // 解码 Base64 数据
      const textContent = atob(merged);

      // 删除分片（不删除元数据）
      chunksMap.delete(fileId);

      return { success: true, data: textContent, size: totalSize };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string): Promise<void> {
    chunksMap.delete(fileId);
    metadataMap.delete(fileId);
  }

  /**
   * 清理过期文件（5 分钟）
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 分钟

    let deletedCount = 0;

    for (const [fileId, metadata] of metadataMap.entries()) {
      if (now - metadata.createdAt > timeout) {
        await this.deleteFile(fileId);
        deletedCount++;
      }
    }

    return deletedCount;
  }
}
