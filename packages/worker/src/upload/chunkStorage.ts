/**
 * ChunkStorage Durable Object - 持久化分片存储
 *
 * 说明：
 * - 每个 fileId 对应一个 Durable Object 实例
 * - 分片写入必须幂等，避免重复上传导致计数错误
 * - 上传完成后，合并后的文件正文写入 R2，DO 只保留元数据和完成标记
 * - 断点续传依赖 metadata 中的 receivedIndices 恢复缺失分片
 */
import type { Env } from '../types';
import { logger } from '../infrastructure/logger';
import { ChunkStorageService } from './chunkStorageService';

export class ChunkStorage implements DurableObject {
  private readonly service: ChunkStorageService;

  constructor(private state: DurableObjectState, private env: Env) {
    this.service = new ChunkStorageService(state, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    logger.debug('ChunkStorage fetch', { action, url: url.href });

    try {
      return await this.service.handleAction(action, request, url);
    } catch (error) {
      logger.error('ChunkStorage error', { action, error });
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
