/**
 * Worker Entry Point - 优化版
 * Task → Step → Skill + MCP Client 架构
 * SSE 流式返回
 */
import type { Env, ChatRequest } from './types';
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
