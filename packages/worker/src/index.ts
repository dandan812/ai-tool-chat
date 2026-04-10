/**
 * Worker 入口只保留系统骨架：
 * 1. 接收请求
 * 2. 按路径分发到对应 handler
 * 3. 统一通过中间件补齐日志、校验和错误处理
 *
 * 这样初学者先看这一层，就能知道“请求从哪里进、会被送到哪里”，
 * 再按 handler -> TaskManager -> Skill 的顺序继续往下读。
 */
import type { Env } from "./types";
import { NotFoundError } from './types';
import {
  compose,
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging,
} from './utils/middleware';
import { ChunkStorage } from "./chunkStorage";
import { handleChatRequest } from './handlers/chatHandlers';
import { handleUploadChunk, handleUploadComplete, handleUploadStatus, handleUploadDelete } from './handlers/uploadHandlers';
import { handleHealthCheck, handleStatsRequest } from './handlers/systemHandlers';

export { ChunkStorage };

/**
 * 主处理函数
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  switch (url.pathname) {
    case '/':
    case '/chat':
      return handleChatRequest(request, env);

    case '/upload/chunk':
      return handleUploadChunk(request, env);

    case '/upload/complete':
      return handleUploadComplete(request, env);

    case '/upload/status':
      return handleUploadStatus(request, env);

    case '/upload/delete':
      return handleUploadDelete(request, env);

    case '/health':
      return handleHealthCheck(env);

    case '/stats':
      return handleStatsRequest(env);

    default:
      throw new NotFoundError(`Route ${url.pathname}`);
  }
}

// 使用中间件包装主处理函数
const app = compose(
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging
)(handleRequest);

export default {
  fetch: async (request: Request, env: Env, ctx?: any): Promise<Response> => {
    return app(request, env);
  },
};
