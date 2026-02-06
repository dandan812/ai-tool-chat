/**
 * Worker Entry Point - 优化版
 * Task → Step → Skill + MCP Client 架构
 * SSE 流式返回
 */
import type { Env, ChatRequest, UploadChunkRequest, UploadCompleteRequest, UploadCompleteResponse, UploadStatusResponse } from './types';
import { ValidationError, NotFoundError } from './types';
import { TaskManager } from './core/taskManager';
import {
  compose,
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging,
  createJSONResponse,
  safeJSONParse,
  createSSEResponse,
} from './utils/middleware';
import { logger } from './utils/logger';
import { serializeSSEEvent } from './utils/sse';
import { chunkManager } from './utils/chunkManager';

export { Env } from './types';

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
  // 解析请求体
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

  // 调试：打印文件信息
  if (files && files.length > 0) {
    logger.info('Received files in request', {
      fileCount: files.length,
      files: files.map(f => ({
        name: f.name,
        contentLength: f.content?.length || 0,
        contentPreview: f.content?.substring(0, 100) || '(empty)',
        mimeType: f.mimeType,
        size: f.size
      }))
    });
  }

  // 验证必需字段
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError('Messages are required');
  }

  // 验证消息格式
  for (const msg of messages) {
    if (!msg.role || !msg.content) {
      throw new ValidationError('Invalid message format', {
        message: msg,
      });
    }
  }

  // 验证 API Key
  if (!env.DEEPSEEK_API_KEY) {
    logger.error('DEEPSEEK_API_KEY not configured');
    throw new ValidationError('Service not configured: missing DEEPSEEK_API_KEY');
  }

  logger.info('Creating task', {
    messageCount: messages.length,
    stream,
    hasImages: !!images?.length,
    enableTools,
  });

  // 创建 TaskManager
  const taskManager = new TaskManager(env);

  // 创建 Task
  const task = taskManager.createTask(body);

  // 非流式响应
  if (!stream) {
    return await handleNonStreamRequest(taskManager, task.id, body);
  }

  // 流式响应
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

  // 异步执行 Task
  const executeTask = async () => {
    try {
      for await (const event of taskManager.executeTask(taskId, request)) {
        const data = `data: ${serializeSSEEvent(event)}\n\n`;
        await writer.write(encoder.encode(data));
      }

      // 发送完成标记
      await writer.write(encoder.encode('data: [DONE]\n\n'));
      logger.info('Task completed', { taskId });
    } catch (error) {
      logger.error('Task execution error', error);
      const errorEvent = {
        type: 'error',
        data: { error: String(error) },
      };
      await writer.write(
        encoder.encode(`data: ${serializeSSEEvent(errorEvent)}\n\n`)
      );
    } finally {
      await writer.close();
    }
  };

  // 启动执行（不等待）
  executeTask();

  // 返回 SSE 响应
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
  // 简单实现 - 实际应该使用全局 TaskManager
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

    // 验证必需字段
    if (!fileId || !chunk || isNaN(chunkIndex)) {
      throw new ValidationError('Missing required fields: fileId, chunk, or chunkIndex');
    }

    // 转换 chunk 为 ArrayBuffer
    const arrayBuffer = await chunk.arrayBuffer();

    // 存储分片
    const success = chunkManager.storeChunk(fileId, chunkIndex, arrayBuffer);

    if (!success) {
      throw new ValidationError('Failed to store chunk');
    }

    // 更新元数据
    chunkManager.updateMetadata(fileId, {
      fileName: '', // 稍后在 complete 时设置
      fileHash,
      totalSize: 0, // 稍后计算
      totalChunks,
      receivedChunks: 0, // 已在 storeChunk 中更新
      receivedIndices: [],
      mimeType,
      createdAt: Date.now(),
    });

    logger.info('Chunk uploaded', {
      fileId,
      chunkIndex,
      chunkSize: arrayBuffer.byteLength,
      totalChunks,
    });

    return createJSONResponse({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: chunkManager.getReceivedCount(fileId),
    });
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

    const { fileId, fileHash, fileName, mimeType } = body;

    // 更新文件名到元数据
    chunkManager.updateMetadata(fileId, {
      fileName,
    });

    // 检查是否所有分片都已上传
    if (!chunkManager.isComplete(fileId)) {
      throw new ValidationError('Not all chunks received yet');
    }

    // 合并分片
    const mergedData = chunkManager.mergeChunks(fileId);

    // 转换为文本（因为我们只处理文本文件）
    const textContent = new TextDecoder().decode(mergedData);

    // 检查文件内容是否为空
    if (!textContent || textContent.length === 0) {
      throw new ValidationError('Uploaded file is empty');
    }

    // 生成文件 ID
    const generateId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

    const fileData = {
      id: generateId(),
      name: fileName,
      content: textContent,
      mimeType: mimeType || 'text/plain',
      size: mergedData.byteLength,
    };

    // 清理分片
    chunkManager.cleanup(fileId);

    logger.info('File upload completed', {
      fileId,
      fileName,
      contentLength: textContent.length,
      size: mergedData.byteLength,
    });

    return createJSONResponse<UploadCompleteResponse>({
      success: true,
      fileData,
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

    const metadata = chunkManager.getMetadata(fileId);

    if (!metadata) {
      throw new NotFoundError(`File ${fileId} not found`);
    }

    const receivedCount = chunkManager.getReceivedCount(fileId);
    const percentage = metadata.totalChunks > 0
      ? (receivedCount / metadata.totalChunks) * 100
      : 0;

    return createJSONResponse<UploadStatusResponse>({
      fileId,
      fileName: metadata.fileName,
      fileHash: metadata.fileHash,
      totalChunks: metadata.totalChunks,
      receivedChunks: receivedCount,
      receivedIndices: chunkManager.getReceivedIndices(fileId),
      percentage,
      isComplete: chunkManager.isComplete(fileId),
    });
  } catch (error) {
    logger.error('Upload status error', error);
    throw error;
  }
}

// 组合中间件
const middleware = compose(
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging
);

// 导出默认 handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 设置日志级别
    if (env.LOG_LEVEL) {
      logger.setLevel(env.LOG_LEVEL);
    }

    const handler = middleware(handleRequest);
    return handler(request, env);
  },
};
