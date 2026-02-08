/**
 * ChunkStorage - 使用 KV Storage 存储分片
 *
 * 使用 KV Storage 作为持久化存储（更简单可靠）
 */

interface ChunkEntry {
  data: string; // Base64 编码的分片数据
  fileName?: string;
  fileHash?: string;
  totalChunks?: number;
  mimeType?: string;
  createdAt?: number;
}

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

export class ChunkStorage {
  constructor(private kv: KVNamespace) {}

  /**
   * 存储分片
   */
  async storeChunk(
    fileId: string,
    chunkIndex: number,
    data: string,
    fileName?: string,
    fileHash?: string,
    totalChunks?: number,
    mimeType?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const key = `chunk:${fileId}:${chunkIndex}`;
      await this.kv.put(key, data);

      // 更新元数据
      const existingMeta = await this.getMetadata(fileId);
      const currentCount = existingMeta?.receivedChunks || 0;
      const currentIndices = existingMeta?.receivedIndices || [];

      const metadata: FileMetadata = {
        fileName: existingMeta?.fileName || fileName || '',
        fileHash: existingMeta?.fileHash || fileHash || '',
        totalSize: existingMeta?.totalSize || data.length,
        totalChunks: existingMeta?.totalChunks || totalChunks || 1,
        receivedChunks: currentCount + 1,
        receivedIndices: [...currentIndices, chunkIndex],
        mimeType: existingMeta?.mimeType || mimeType || 'text/plain',
        createdAt: existingMeta?.createdAt || Date.now(),
      };

      await this.setMetadata(fileId, metadata);

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 获取元数据
   */
  async getMetadata(fileId: string): Promise<FileMetadata | null> {
    const key = `meta:${fileId}`;
    const value = await this.kv.get<FileMetadata>(key);
    return value;
  }

  /**
   * 设置元数据
   */
  async setMetadata(fileId: string, metadata: FileMetadata): Promise<void> {
    const key = `meta:${fileId}`;
    await this.kv.put(key, metadata);
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

      // 收集所有分片
      const chunks: string[] = [];
      let totalSize = 0;

      for (let i = 0; i < totalChunks; i++) {
        const key = `chunk:${fileId}:${i}`;
        const chunk = await this.kv.get<string>(key);

        if (!chunk) {
          return { success: false, error: `Chunk ${i} not found` };
        }

        chunks.push(chunk);
        totalSize += chunk.length;
      }

      // 合并所有分片
      const merged = chunks.join('');

      // 删除分片
      for (let i = 0; i < totalChunks; i++) {
        const key = `chunk:${fileId}:${i}`;
        await this.kv.delete(key);
      }

      return { success: true, data: merged, size: totalSize };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string): Promise<void> {
    // 删除分片
    const metadata = await this.getMetadata(fileId);
    if (metadata) {
      const { totalChunks } = metadata;

      for (let i = 0; i < totalChunks; i++) {
        const key = `chunk:${fileId}:${i}`;
        await this.kv.delete(key);
      }
    }

    // 删除元数据
    const metaKey = `meta:${fileId}`;
    await this.kv.delete(metaKey);
  }

  /**
   * 清理过期文件（5 分钟）
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 分钟

    let deletedCount = 0;
    const metadataList = await this.kv.list<FileMetadata>({ prefix: 'meta:' });

    for (const { key } of metadataList.keys) {
      const metadata = await this.kv.get<FileMetadata>(key);
      if (metadata && now - metadata.createdAt > timeout) {
        await this.deleteFile(key.substring(5)); // 去掉 'meta:' 前缀
        deletedCount++;
      }
    }

    return deletedCount;
  }
}
