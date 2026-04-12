import type { ChatRequest, Env } from '../types';
import { ValidationError } from '../types';
import { TaskManager } from '../core/taskManager';
import {
  createJSONResponse,
  safeJSONParse,
  serializeSSEEvent,
} from '../infrastructure/middleware';
import { logger } from '../infrastructure/logger';
import { createErrorDetails, ERROR_CODES } from '../infrastructure/observability';

/**
 * 聊天接口是后端主链路的入口。
 * 这里故意只负责“请求校验 + 任务创建 + 流式/非流式分流”，
 * 具体的 Task -> Step -> Skill 编排继续交给 TaskManager，
 * 这样初学者可以先看懂入口，再深入执行细节。
 */
export async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  // 入口层先把原始 HTTP body 变成结构化对象，
  // 后续 TaskManager / Skill 都只接受已经校验过的业务数据。
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

  // 非流式模式主要给测试或调试使用：
  // 先把所有事件收集完，再一次性返回 JSON。
  if (!stream) {
    return handleNonStreamRequest(taskManager, task.id, body);
  }

  // 默认走流式，让前端可以边收边渲染内容。
  return handleStreamRequest(taskManager, task.id, body);
}

/**
 * 非流式路径会把 Task 执行产生的所有事件先缓存到内存里，
 * 最终和任务状态一起打包成普通 JSON 返回。
 */
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

/**
 * 流式路径把 TaskManager 产生的事件逐条编码成 SSE。
 * 前端看到的“步骤更新”“模型输出文字”都来自这里写出的事件流。
 */
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
        // SSE 协议要求每条消息以 `data: ...\\n\\n` 的形式输出，
        // 浏览器 EventSource 才能按事件边界正确消费。
        const data = `data: ${serializeSSEEvent(event)}\n\n`;
        await writer.write(encoder.encode(data));
      }

      // 显式补一个结束标记，方便前端把“生成中”状态切换为“已完成”。
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
      // 即使执行失败，也尽量把错误包装成 SSE 事件返回，
      // 避免前端只看到连接中断，不知道具体报错。
      const errorEvent = {
        type: 'error',
        data: { error: String(error) },
      };
      await writer.write(encoder.encode(`data: ${serializeSSEEvent(errorEvent)}\n\n`));
    } finally {
      await writer.close();
    }
  };

  // 不阻塞当前请求，让 Response 先把可读流返回给客户端，
  // 后台协程再持续往 writable 里写事件。
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
