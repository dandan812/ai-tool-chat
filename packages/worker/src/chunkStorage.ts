/**
 * ChunkStorage Durable Object - 持久化分片存储
 *
 * 使用 Durable Objects 解决 Workers 无状态问题
 * 确保分片数据在多个请求间持久化
 */

/**
 * 分片数据接口
 */
interface ChunkData {
  fileId: string;
  chunkIndex: number;
  data: ArrayBuffer;
  fileName?: string;
  fileHash?: string;
  totalChunks?: number;
  mimeType?: string;
  createdAt?: number;
}

/**
 * 文件元数据接口
 */
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

/**
 * 状态存储接口
 */
interface StorageState {
  chunks: Map<string, Map<number, ArrayBuffer>>;
  metadata: Map<string, FileMetadata>;
}

export class ChunkStorage implements DurableObject {
  private stateData: StorageState = {
    chunks: new Map(),
    metadata: new Map()
  };

  constructor(private state: DurableObjectState) {
    // 从持久化存储加载状态
    this.loadState();
  }

  /**
   * 从持久化存储加载状态
   */
  private async loadState(): Promise<void> {
    const stored = await this.state.storage.get<StorageState>('state');
    if (stored) {
      this.stateData = stored;
    }
  }

  /**
   * 保存状态到持久化存储
   */
  private async saveState(): Promise<void> {
    this.stateData.chunks = new Map(this.stateData.chunks);
    this.stateData.metadata = new Map(this.stateData.metadata);
    await this.state.storage.put('state', this.stateData);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    logger.debug('ChunkStorage request', { action, url: url.href });

    try {
      switch (action) {
        case 'storeChunk':
          return await this.handleStoreChunk(request);

        case 'getMetadata':
          return await this.handleGetMetadata(request);

        case 'getAllChunks':
          return await this.handleGetAllChunks(request);

        case 'isComplete':
          return await this.handleIsComplete(request);

        case 'mergeChunks':
          return await this.handleMergeChunks(request);

        case 'deleteFile':
          return await this.handleDeleteFile(request);

        default:
          return new Response('Unknown action', { status: 400 });
      }
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  /**
   * 获取当前状态（使用实例变量）
   */
  private getState(): StorageState {
    return this.stateData;
  }

  /**
   * 保存状态到持久化存储
   */
  private async setState(state: StorageState): Promise<void> {
    this.stateData = state;
    await this.saveState();
  }

  /**
   * 存储分片
   */
  private async handleStoreChunk(request: Request): Promise<Response> {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0');
    const chunk = formData.get('chunk') as File;
    const totalChunks = parseInt(formData.get('totalChunks') as string || '0');
    const fileHash = formData.get('fileHash') as string;
    const mimeType = formData.get('mimeType') as string || 'text/plain';

    if (!fileId || !chunk || isNaN(chunkIndex)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const arrayBuffer = await chunk.arrayBuffer();
    const state = this.getState();

    // 初始化文件分片存储
    if (!state.chunks.has(fileId)) {
      state.chunks.set(fileId, new Map());
    }

    // 存储分片
    const fileChunks = state.chunks.get(fileId)!;
    fileChunks.set(chunkIndex, arrayBuffer);

    // 更新或初始化元数据
    const existingMetadata = state.metadata.get(fileId);
    const currentCount = existingMetadata?.receivedChunks || 0;
    const currentIndices = existingMetadata?.receivedIndices || [];

    const metadata: FileMetadata = {
      fileId,
      fileName: existingMetadata?.fileName || '',
      fileHash: existingMetadata?.fileHash || fileHash,
      totalSize: existingMetadata?.totalSize || 0,
      totalChunks: existingMetadata?.totalChunks || totalChunks,
      receivedChunks: currentCount + 1,
      receivedIndices: [...currentIndices, chunkIndex],
      mimeType: existingMetadata?.mimeType || mimeType,
      createdAt: existingMetadata?.createdAt || Date.now(),
    };

    state.metadata.set(fileId, metadata);
    await this.setState(state);

    return new Response(JSON.stringify({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: metadata.receivedChunks
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 获取元数据
   */
  private async handleGetMetadata(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const state = this.getState();
    const metadata = state.metadata.get(fileId);

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
   * 获取所有分片
   */
  private async handleGetAllChunks(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const state = this.getState();
    const fileChunks = state.chunks.get(fileId);

    if (!fileChunks) {
      return new Response(JSON.stringify({ chunks: [] }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const chunks: Array<{ index: number; size: number }> = [];
    for (const [index, data] of fileChunks.entries()) {
      chunks.push({ index, size: data.byteLength });
    }

    return new Response(JSON.stringify({ chunks }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 检查是否完整
   */
  private async handleIsComplete(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const state = this.getState();
    const metadata = state.metadata.get(fileId);
    const fileChunks = state.chunks.get(fileId);

    if (!metadata || !fileChunks) {
      return new Response(JSON.stringify({ isComplete: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const isComplete = metadata.receivedChunks >= metadata.totalChunks &&
                     fileChunks.size >= metadata.totalChunks;

    return new Response(JSON.stringify({ isComplete }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 合并分片
   */
  private async handleMergeChunks(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const state = this.getState();
    const metadata = state.metadata.get(fileId);
    const fileChunks = state.chunks.get(fileId);

    if (!metadata || !fileChunks) {
      return new Response(JSON.stringify({ error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 创建合并后的 ArrayBuffer
    const merged = new Uint8Array(metadata.totalSize);
    let offset = 0;

    // 按顺序合并分片
    for (let i = 0; i < metadata.totalChunks; i++) {
      const chunk = fileChunks.get(i);

      if (!chunk) {
        return new Response(JSON.stringify({ error: `Chunk ${i} missing` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const chunkData = new Uint8Array(chunk);
      merged.set(chunkData, offset);
      offset += chunk.byteLength;
    }

    // 删除文件数据
    state.chunks.delete(fileId);
    state.metadata.delete(fileId);
    await this.setState(state);

    // 转换为 Base64 返回（避免传输问题）
    const base64 = btoa(String.fromCharCode(...new Uint8Array(merged)));

    return new Response(JSON.stringify({
      success: true,
      fileId,
      data: base64,
      size: merged.byteLength
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * 删除文件
   */
  private async handleDeleteFile(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      return new Response(JSON.stringify({ error: 'Missing fileId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const state = this.getState();
    state.chunks.delete(fileId);
    state.metadata.delete(fileId);
    await this.setState(state);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
