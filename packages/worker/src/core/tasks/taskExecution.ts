import type { ChatRequest, Env, EvidenceSource } from '../../types'
import { TaskManager } from '../taskManager'
import { MAX_OUTPUT_CHARS, type TaskRecord } from './taskRecord'
import { TaskRepository } from './taskRepository'
import { TaskUsageTracker } from './taskUsage'

/** 文字片段落盘后立即通知观察者，不拥有 DO 的重启/调度策略。 */
export async function executeAndPersistTask(
  env: Env,
  record: TaskRecord,
  request: ChatRequest,
  repository: TaskRepository,
  usage: TaskUsageTracker,
  signal: AbortSignal
): Promise<void> {
  const manager = new TaskManager({ ...env, RUNTIME_CONTROL: usage.control(signal) })
  const task = manager.createTask(request, record.task.id)
  task.createdAt = record.task.createdAt
  let partial = ''
  for await (const event of manager.executeTask(task.id, request)) {
    signal.throwIfAborted()
    if (event.type === 'content') {
      const content = (event.data as { content: string }).content
      if (!content) continue
      if (partial.length + content.length > MAX_OUTPUT_CHARS) throw new Error('TASK_OUTPUT_LIMIT')
      partial += content
      const firstContent = usage.metrics.firstContentMs === null
      if (firstContent) usage.metrics.firstContentMs = Date.now() - record.task.createdAt
      task.result = partial
      await repository.append(event, task, usage.metrics)
      continue
    }
    if (event.type === 'sources') {
      await repository.appendSources((event.data as { sources: EvidenceSource[] }).sources)
      continue
    }
    task.result = partial || task.result
    if (event.type === 'error') {
      const failure = event.data as { code?: string; error?: string }
      const budgetExceeded = failure.code === 'BUDGET_LIMIT'
      const documentFailure =
        failure.code?.startsWith('DOCUMENT_') && typeof failure.error === 'string'
      const researchFailure =
        (failure.code?.startsWith('AGENT_') || failure.code === 'EVIDENCE_INVALID') &&
        typeof failure.error === 'string'
      await repository.terminate(
        'failed',
        documentFailure || researchFailure
          ? failure.code!
          : budgetExceeded
            ? 'BUDGET_EXCEEDED'
            : 'TASK_EXECUTION_FAILED',
        documentFailure || researchFailure
          ? failure.error!.replace(/^WorkerError:\s*/, '')
          : budgetExceeded
            ? '任务调用次数或 token 预算不足，已停止后续调用并保存已有内容。'
            : '模型调用失败，已保留收到的部分内容。',
        usage.metrics.modelCalls > 0
      )
      return
    }
    await repository.append(event, task, usage.metrics)
  }
}
