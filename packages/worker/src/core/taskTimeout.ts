import { logger } from '../utils/logger';
import { TaskStore } from './taskStore';

export const TASK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 超时控制独立出来，是为了让 TaskManager 主流程只关注“正常路径”，
 * 把失败收尾这种横切逻辑收口到一个地方。
 */
export function startTaskTimeout(
  taskStore: TaskStore,
  taskId: string,
  timeoutMs: number = TASK_TIMEOUT_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const didTimeout = taskStore.markFailed(taskId, 'Task execution timeout');
    if (didTimeout) {
      logger.error('Task timeout', { taskId, timeoutMs });
    }
  }, timeoutMs);
}
