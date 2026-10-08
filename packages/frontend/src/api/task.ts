import type { TaskCallbacks, TaskRequest } from './requestManager'
import { TaskRequestManager } from './requestManager'

export type { TaskCallbacks, TaskRequest } from './requestManager'

// Keep the original API entry points; restore only reads an existing durable task.
export async function sendTaskRequest(
  request: TaskRequest,
  callbacks: TaskCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const manager = new TaskRequestManager(callbacks, signal)
  await manager.send(request)
}

export async function resumeTaskRequest(
  taskId: string,
  callbacks: TaskCallbacks,
  signal?: AbortSignal
): Promise<void> {
  await new TaskRequestManager(callbacks, signal).resume(taskId)
}
