import type { ChatRequest, Env } from '../types';
import { ValidationError } from '../types';
import { TaskManager } from '../core/taskManager';
import {
  createJSONResponse,
  safeJSONParse,
  serializeSSEEvent,
} from '../utils/middleware';
import { logger } from '../utils/logger';
import { createErrorDetails, ERROR_CODES } from '../utils/observability';

/**
 * 聊天接口是后端主链路的入口。
 * 这里故意只负责“请求校验 + 任务创建 + 流式/非流式分流”，
 * 具体的 Task -> Step -> Skill 编排继续交给 TaskManager，
 * 这样初学者可以先看懂入口，再深入执行细节。
 */
export async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  const body = await safeJSONParse<ChatRequest>(request);

  if (!body) {
    throw new ValidationError(
      'Invalid JSON body',
      createErrorDetails(ERROR_CODES.CHAT_INVALID_JSON),
    );
  }

  const {
    messages = [],
    stream = true,
    images,
    files,
    enableTools,
  } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ValidationError(
      'Messages are required',
      createErrorDetails(ERROR_CODES.CHAT_MESSAGES_REQUIRED),
    );
  }

  logger.info('Creating task', {
    route: '/chat',
    requestType: 'chat',
    messageCount: messages.length,
    stream,
    hasImages: !!images?.length,
    hasFiles: !!files?.length,
    enableTools,
  });

  const taskManager = new TaskManager(env);
  const task = taskManager.createTask(body);

  logger.info('Task created for chat request', {
    route: '/chat',
    requestType: 'chat',
    taskId: task.id,
    hasImages: !!images?.length,
    hasFiles: !!files?.length,
  });

  if (!stream) {
    return handleNonStreamRequest(taskManager, task.id, body);
  }

  return handleStreamRequest(taskManager, task.id, body);
}

async function handleNonStreamRequest(
  taskManager: TaskManager,
  taskId: string,
  request: ChatRequest,
): Promise<Response> {
  const chunks: unknown[] = [];

  for await (const chunk of taskManager.executeTask(taskId, request)) {
    chunks.push(chunk);
  }

  const finalTask = taskManager.getTask(taskId);
  logger.info('Non-stream task finished', {
    route: '/chat',
    requestType: 'chat',
    taskId,
    status: finalTask?.status,
    model: finalTask?.metadata?.model,
    skill: finalTask?.metadata?.skill,
  });

  return createJSONResponse({ task: finalTask, chunks });
}

function handleStreamRequest(
  taskManager: TaskManager,
  taskId: string,
  request: ChatRequest,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const executeTask = async () => {
    try {
      for await (const event of taskManager.executeTask(taskId, request)) {
        const data = `data: ${serializeSSEEvent(event)}\n\n`;
        await writer.write(encoder.encode(data));
      }

      await writer.write(encoder.encode('data: [DONE]\n\n'));
      const finalTask = taskManager.getTask(taskId);
      logger.info('Stream task completed', {
        route: '/chat',
        requestType: 'chat',
        taskId,
        durationMs: Date.now() - startedAt,
        skill: finalTask?.metadata?.skill,
        model: finalTask?.metadata?.model,
      });
    } catch (error) {
      logger.error('Task execution error', {
        route: '/chat',
        requestType: 'chat',
        taskId,
        durationMs: Date.now() - startedAt,
        errorCode: ERROR_CODES.CHAT_TASK_EXECUTION_FAILED,
        error,
      });
      const errorEvent = {
        type: 'error',
        data: { error: String(error) },
      };
      await writer.write(encoder.encode(`data: ${serializeSSEEvent(errorEvent)}\n\n`));
    } finally {
      await writer.close();
    }
  };

  void executeTask();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
