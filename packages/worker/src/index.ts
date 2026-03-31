/**
 * Worker Entry Point
 * Task → Step → Skill + MCP Client 架构
 * SSE 流式返回 + 文件上传端点（使用 Durable Objects）
 */
import type { Env, ChatRequest, UploadCompleteRequest, UploadCompleteResponse, UploadStatusResponse } from "./types";
import { ValidationError, NotFoundError } from './types';
import { TaskManager } from "./core/taskManager";
import {
  compose,
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging,
  createJSONResponse,
  safeJSONParse,
  serializeSSEEvent,
} from './utils/middleware';
import { logger } from './utils/logger';
import { ChunkStorage } from "./chunkStorage";
import { createChunkStorageUrl, getChunkStorageStub } from './utils/uploadedFileStorage';

export { ChunkStorage };

/**
 * 主处理函数
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // 路由处理
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

    case '/health':
      return handleHealthCheck(env);

    case '/stats':
      return handleStatsRequest(request, env);

    default:
      throw new NotFoundError(`Route ${url.pathname}`);
  }
}

/**
 * 处理聊天请求
 */
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  const body = await safeJSONParse<ChatRequest>(request);

  if (!body) {
    throw new ValidationError('Invalid JSON body');
  }

  const {
    messages = [],
    stream = true,
    images,
    files,
    enableTools,
    temperature = 0.7,
  } = body;

  // 验证必需字段
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError('Messages are required');
  }

  logger.info('Creating task', {
    messageCount: messages.length,
    stream,
    hasImages: !!images?.length,
    hasFiles: !!files?.length,
    enableTools,
  });

  const taskManager = new TaskManager(env);
  const task = taskManager.createTask(body);

  // 流式响应
  if (!stream) {
    return handleNonStreamRequest(taskManager, task.id, body);
  }

  return handleStreamRequest(taskManager, task.id, body);
}

/**
 * 处理非流式请求
 */
async function handleNonStreamRequest(
  taskManager: TaskManager,
  taskId: string,
  request: ChatRequest
): Promise<Response> {
  const chunks: unknown[] = [];

  for await (const chunk of taskManager.executeTask(taskId, request)) {
    chunks.push(chunk);
  }

  const finalTask = taskManager.getTask(taskId);
  return createJSONResponse({ task: finalTask, chunks });
}

/**
 * 处理流式请求 (SSE)
 */
function handleStreamRequest(
  taskManager: TaskManager,
  taskId: string,
  request: ChatRequest
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const executeTask = async () => {
    try {
      for await (const event of taskManager.executeTask(taskId, request)) {
        const data = `data: ${serializeSSEEvent(event)}\n\n`;
        await writer.write(encoder.encode(data));
      }

      await writer.write(encoder.encode('data: [DONE]\n\n'));
      logger.info('Task completed', { taskId });
    } catch (error) {
      logger.error('Task execution error', error);
      const errorEvent = {
        type: 'error',
        data: { error: String(error) },
      };
      await writer.write(encoder.encode(`data: ${serializeSSEEvent(errorEvent)}\n\n`));
    } finally {
      await writer.close();
    }
  };

  executeTask();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * 健康检查
 */
function handleHealthCheck(env: Env): Response {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: {
      deepseek: !!env.DEEPSEEK_API_KEY,
      qwen: !!env.QWEN_API_KEY,
      openai: !!env.OPENAI_API_KEY,
      anthropic: !!env.ANTHROPIC_API_KEY,
    },
  };

  return createJSONResponse(status);
}

/**
 * 统计信息接口
 */
async function handleStatsRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const taskManager = new TaskManager(env);
  const stats = taskManager.getStats();

  return createJSONResponse({
    tasks: stats,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 处理分片上传
 */
async function handleUploadChunk(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const chunkIndex = parseInt(formData.get('chunkIndex') as string || '0');
    const totalChunks = parseInt(formData.get('totalChunks') as string || '0');
    const fileHash = formData.get('fileHash') as string;
    const chunk = formData.get('chunk') as File;
    const mimeType = formData.get('mimeType') as string || 'text/plain';

    if (!fileId || !chunk || isNaN(chunkIndex)) {
      throw new ValidationError('Missing required fields: fileId, chunk, or chunkIndex');
    }

    const arrayBuffer = await chunk.arrayBuffer();

    logger.info('Uploading chunk', { fileId, chunkIndex, size: arrayBuffer.byteLength });

    const durableObjectUrl = createChunkStorageUrl(
      `/?action=storeChunk&fileId=${encodeURIComponent(fileId)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&fileHash=${encodeURIComponent(fileHash)}&mimeType=${encodeURIComponent(mimeType)}`
    );
    const chunkStorage = getChunkStorageStub(env, fileId);

    const durableRequest = new Request(durableObjectUrl, {
      method: 'POST',
      body: formData,
    });

    const durableResponse = await chunkStorage.fetch(durableRequest);

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error('Durable Object error', error);
      throw new ValidationError(`Durable Object error: ${error}`);
    }

    const result = await durableResponse.json();
    logger.info('Chunk stored', { fileId, chunkIndex, result });

    return createJSONResponse(result);
  } catch (error) {
    logger.error('Upload chunk error', error);
    throw error;
  }
}

/**
 * 处理上传完成
 */
async function handleUploadComplete(request: Request, env: Env): Promise<Response> {
  try {
    const body = await safeJSONParse<UploadCompleteRequest>(request);
    if (!body) {
      throw new ValidationError('Invalid JSON body');
    }

    const { fileId, fileName } = body;

    logger.info('Upload complete request', { fileId, fileName });
    const chunkStorage = getChunkStorageStub(env, fileId);

    // 先检查元数据状态（调试）
    const checkDurableUrl = createChunkStorageUrl(`/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`);
    const checkResponse = await chunkStorage.fetch(checkDurableUrl);
    const checkData = await checkResponse.json();
    logger.info('Metadata check before merge', { fileId, checkData });

    const durableObjectUrl = createChunkStorageUrl(`/?action=mergeChunks&fileId=${encodeURIComponent(fileId)}`);
    const durableRequest = new Request(durableObjectUrl, {
      method: 'GET',  // 改为 GET，因为现在通过 URL 传递参数
    });

    const durableResponse = await chunkStorage.fetch(durableRequest);

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error('Durable Object error', error);
      throw new ValidationError(`Durable Object error: ${error}`);
    }

    const result = await durableResponse.json();
    logger.info('Chunks merged', { fileId, result });

    if (!result.success) {
      throw new ValidationError(result.error || 'Merge failed');
    }

    return createJSONResponse<UploadCompleteResponse>({
      success: true,
      file: result.file,
    });
  } catch (error) {
    logger.error('Upload complete error', error);
    throw error;
  }
}

/**
 * 查询上传状态
 */
async function handleUploadStatus(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      throw new ValidationError('Missing fileId parameter');
    }

    logger.info('Upload status request', { fileId });
    const chunkStorage = getChunkStorageStub(env, fileId);

    // 获取元数据
    const durableObjectUrl = createChunkStorageUrl(`/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`);
    const durableResponse = await chunkStorage.fetch(durableObjectUrl);

    if (!durableResponse.ok) {
      throw new NotFoundError(`File ${fileId} not found`);
    }

    const metadata = await durableResponse.json();
    logger.info('Got metadata', { fileId, metadata });

    if (!metadata) {
      throw new ValidationError('Invalid metadata response');
    }

    const percentage = metadata.totalChunks > 0
      ? Math.round((metadata.receivedChunks / metadata.totalChunks) * 100)
      : 0;

    return createJSONResponse<UploadStatusResponse>({
      fileId,
      fileName: metadata.fileName,
      fileHash: metadata.fileHash,
      totalChunks: metadata.totalChunks,
      receivedChunks: metadata.receivedChunks,
      receivedIndices: metadata.receivedIndices,
      percentage,
      isComplete: metadata.receivedChunks >= metadata.totalChunks,
    });
  } catch (error) {
    logger.error('Upload status error', error);
    throw error;
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
