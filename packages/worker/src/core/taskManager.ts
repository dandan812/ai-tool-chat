/**
 * TaskManager 现在只保留对外的任务入口：
 * - 创建任务
 * - 启动执行
 * - 查询状态与统计
 *
 * 生命周期缓存、步骤编排和超时控制都拆到了独立模块，
 * 方便初学者先理解主链路，再按需深入各个子层。
 */
import type { ChatRequest, Env, Task } from '../types';
import { now } from '../utils/id';
import { logger } from '../utils/logger';
import { TaskStepRunner } from './taskStepRunner';
import type { TaskStreamEvent } from './taskManagerTypes';
import { TaskStore } from './taskStore';
import { startTaskTimeout, TASK_TIMEOUT_MS } from './taskTimeout';

export class TaskManager {
  private readonly taskStore: TaskStore;
  private readonly stepRunner: TaskStepRunner;

  constructor(env: Env) {
    this.taskStore = new TaskStore();
    this.stepRunner = new TaskStepRunner(env, this.taskStore);
  }

  createTask(request: ChatRequest): Task {
    return this.taskStore.createTask(request);
  }

  async *executeTask(
    taskId: string,
    request: ChatRequest,
  ): AsyncIterable<TaskStreamEvent> {
    const { task, error } = this.taskStore.prepareTaskForExecution(taskId);
    if (!task) {
      yield { type: 'error', data: { error } };
      return;
    }

    yield { type: 'task', data: { task, event: 'started' } };

    const startTime = now();
    const timeoutId = startTaskTimeout(this.taskStore, taskId, TASK_TIMEOUT_MS);

    try {
      yield* this.stepRunner.run(task, request);
      clearTimeout(timeoutId);

      if (task.status === 'running') {
        this.taskStore.markCompleted(taskId);
      }

      logger.info('Task completed', {
        taskId,
        duration: now() - startTime,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      logger.error('Task execution failed', { taskId, error });
      this.taskStore.markFailed(taskId, String(error));
      yield { type: 'error', data: { error: String(error), task } };
    }
  }

  getTask(taskId: string): Task | undefined {
    return this.taskStore.getTask(taskId);
  }

  listTasks(): Task[] {
    return this.taskStore.listTasks();
  }

  deleteTask(taskId: string): boolean {
    return this.taskStore.deleteTask(taskId);
  }

  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    return this.taskStore.getStats();
  }
}
