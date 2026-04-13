import type { TaskCallbacks, TaskRequest } from './requestManager'
import { TaskRequestManager } from './requestManager'

export type { TaskCallbacks, TaskRequest } from './requestManager'

/**
 * 兼容旧调用入口，内部改为委托给统一请求管理器。
 */
export async function sendTaskRequest(
  request: TaskRequest,
  callbacks: TaskCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const manager = new TaskRequestManager(callbacks, signal)
  await manager.send(request)
}
