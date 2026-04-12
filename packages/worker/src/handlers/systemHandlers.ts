import type { Env } from '../types';
import { TaskManager } from '../core/taskManager';
import { createJSONResponse } from '../infrastructure/middleware';

/**
 * 健康检查只暴露当前运行时能否调用百炼能力，
 * 避免把无关的历史供应商状态继续暴露给排障入口。
 */
export function handleHealthCheck(env: Env): Response {
  return createJSONResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: {
      bailianText: !!env.QWEN_API_KEY,
      bailianMultimodal: !!env.QWEN_API_KEY,
    },
  });
}

export function handleStatsRequest(env: Env): Response {
  const taskManager = new TaskManager(env);
  return createJSONResponse({
    tasks: taskManager.getStats(),
    timestamp: new Date().toISOString(),
  });
}
