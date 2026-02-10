/**
 * ChunkStorage Durable Object - 持久化分片存储
 *
 * 正确实现 Durable Object 接口
 */
import { logger } from './utils/logger';

interface ChunkEntry {
  fileId: string;
  chunkIndex: number;
  data: ArrayBuffer;
  fileName?: string;
  fileHash?: string;
  totalChunks?: number;
  mimeType?: string;
  createdAt?: number;
}

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
}

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

        case 'isComplete':
          return await this.handleIsComplete(url);

        case 'mergeChunks':
          return await this.handleMergeChunks();

        case 'deleteFile':
          return await this.handleDeleteFile(url);

        case 'cleanup':
          return await this.handleCleanup();

        default:
          return new Response('Unknown action', { status: 400 });
      }
    } catch (error) {
      logger.error('ChunkStorage error', { action, error });
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * 存储分片
   */
  private async handleStoreChunk(request: Request): Promise<Response> {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0');
    const totalChunks = parseInt(formData.get('totalChunks') as string || '0');
    const fileHash = formData.get('fileHash') as string;
    const chunk = formData.get('chunk') as File;
    const mimeType = formData.get('mimeType') as string || 'text/plain';

    if (!fileId || !chunk || isNaN(chunkIndex)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const arrayBuffer = await chunk.arrayBuffer();

    // 先在事务外获取或创建元数据
    const metadataKey = `meta:${fileId}`;
    let metadata = await this.state.get<FileMetadata>(metadataKey);

    if (!metadata) {
      // 初始化元数据
      metadata = {
        fileName: '',
        fileHash,
        totalSize: arrayBuffer.byteLength,
        totalChunks: parseInt(totalChunks as string) || 1,
        receivedChunks: 0,
        receivedIndices: [],
        mimeType,
        createdAt: Date.now(),
      };
    }

    // 更新元数据计数
    const updatedMetadata: FileMetadata = {
      ...metadata,
      receivedChunks: metadata.receivedChunks + 1,
      receivedIndices: [...metadata.receivedIndices, chunkIndex],
    };

    // 使用事务确保原子性
    await this.state.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);

      // 存储分片
      const chunkKey = `chunk:${fileId}:${chunkIndex}`;
      await txn.put(chunkKey, arrayBuffer);
    });

    return new Response(JSON.stringify({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: updatedMetadata.receivedChunks,
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 获取元数据
   */
  private async handleGetMetadata(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const metadataKey = `meta:${fileId}`;
    const metadata = await this.state.get<FileMetadata>(metadataKey);

    if (!metadata) {
      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(metadata), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 检查是否完整
   */
  private async handleIsComplete(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const metadataKey = `meta:${fileId}`;
    const metadata = await this.state.get<FileMetadata>(metadataKey);

    if (!metadata) {
      return new Response(JSON.stringify({ isComplete: false }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const isComplete = metadata.receivedChunks >= metadata.totalChunks;

    return new Response(JSON.stringify({ isComplete }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 合并分片
   */
  private async handleMergeChunks(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 先在事务外获取元数据，避免在事务内使用 list() 导致堆栈溢出
    const metadataKey = `meta:${fileId}`;
    const metadata = await this.state.get<FileMetadata>(metadataKey);

    if (!metadata) {
      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 检查是否所有分片都已上传
    if (metadata.receivedChunks < metadata.totalChunks) {
      return new Response(JSON.stringify({
        success: false,
        error: `Incomplete upload: ${metadata.receivedChunks}/${metadata.totalChunks} chunks received`
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 收集所有分片并在事务内合并
    const result = await this.state.transaction(async (txn) => {
      const chunks: ArrayBuffer[] = [];
      for (let i = 0; i < metadata.totalChunks; i++) {
        const chunkKey = `chunk:${fileId}:${i}`;
        const chunk = await txn.get<ArrayBuffer>(chunkKey);
        if (!chunk) {
          return { success: false, error: `Chunk ${i} not found` };
        }
        chunks.push(chunk);
      }

      // 合并所有分片
      const merged = new Uint8Array(metadata.totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // 转换为 Base64（使用 TextDecoder 正确处理）
      const textDecoder = new TextDecoder();
      const textContent = textDecoder.decode(merged);
      const base64 = btoa(textContent);

      // 删除分片
      for (let i = 0; i < metadata.totalChunks; i++) {
        await txn.delete(`chunk:${fileId}:${i}`);
      }

      // 删除元数据
      await txn.delete(`meta:${fileId}`);

      return {
        success: true,
        data: base64,
        size: metadata.totalSize,
      };
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 删除文件
   */
  private async handleDeleteFile(url: URL): Promise<Response> {
    const fileId = url.searchParams.get('fileId');
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const result = await this.state.transaction(async (txn) => {
      // 删除所有分片
      for (let i = 0; i < 100; i++) { // 限制避免无限循环
        const chunkKey = `chunk:${fileId}:${i}`;
        await txn.delete(chunkKey);
        if (!(await txn.get(chunkKey))) {
          break; // 分片已删除完毕
        }
      }

      // 删除元数据
      await txn.delete(`meta:${fileId}`);

      return { success: true };
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 清理过期文件（5 分钟）
   */
  private async handleCleanup(): Promise<Response> {
    // 先在事务外列出所有文件
    const files = await this.state.list<FileMetadata>({ prefix: 'meta:' });
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 分钟

    const keysToDelete: string[] = [];
    for (const [key, value] of files) {
      if (now - value.createdAt > timeout) {
        keysToDelete.push(key);
      }
    }

    // 在事务内删除
    const result = await this.state.transaction(async (txn) => {
      let deletedCount = 0;
      for (const key of keysToDelete) {
        await txn.delete(key);
        deletedCount++;
      }
      return { deletedCount };
    });

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
