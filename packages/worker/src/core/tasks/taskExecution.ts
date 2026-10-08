import type { ChatRequest, Env, EvidenceSource } from '../../types';
import { TaskManager } from '../taskManager';
import { MAX_OUTPUT_CHARS, type TaskRecord } from './taskRecord';
import { TaskRepository } from './taskRepository';
import { TaskUsageTracker } from './taskUsage';

/** 消费执行事件，合并内容小片段后落盘，不拥有 DO 的重启/调度策略。 */
export async function executeAndPersistTask(
  env: Env, record: TaskRecord, request: ChatRequest,
  repository: TaskRepository, usage: TaskUsageTracker, signal: AbortSignal,
): Promise<void> {
  const manager = new TaskManager({ ...env, RUNTIME_CONTROL: usage.control(signal) });
  const task = manager.createTask(request, record.task.id);
  task.createdAt = record.task.createdAt;
  let partial = '';
  let pending = '';
  let lastFlush = Date.now();
  const flush = async () => {
    if (!pending) return;
    const content = pending;
    pending = '';
    task.result = partial;
    await repository.append({ type: 'content', data: { content } }, task, usage.metrics);
    lastFlush = Date.now();
  };

  for await (const event of manager.executeTask(task.id, request)) {
    signal.throwIfAborted();
    if (event.type === 'content') {
      const content = (event.data as { content: string }).content;
      if (partial.length + content.length > MAX_OUTPUT_CHARS) throw new Error('TASK_OUTPUT_LIMIT');
      partial += content;
      pending += content;
      const firstContent = usage.metrics.firstContentMs === null;
      if (firstContent) usage.metrics.firstContentMs = Date.now() - record.task.createdAt;
      if (firstContent || pending.length >= 1000 || Date.now() - lastFlush >= 200) await flush();
      continue;
    }
    await flush();
    if (event.type === 'sources') {
      await repository.appendSources((event.data as { sources: EvidenceSource[] }).sources);
      continue;
    }
    task.result = partial || task.result;
    if (event.type === 'error') {
      const budgetExceeded = (event.data as { code?: string }).code === 'BUDGET_LIMIT';
      await repository.terminate(
        'failed', budgetExceeded ? 'BUDGET_EXCEEDED' : 'TASK_EXECUTION_FAILED',
        budgetExceeded ? '任务调用次数或 token 预算不足，已停止后续调用并保存已有内容。' : '模型调用失败，已保留收到的部分内容。',
        usage.metrics.modelCalls > 0,
      );
      return;
    }
    await repository.append(event, task, usage.metrics);
  }
  await flush();
}
