import type { ChatRequest, Step, Task, TaskMetadata, ToolingMode } from '../types';
import { generateId, now } from '../utils/id';
import { logger } from '../infrastructure/logger';

const MAX_TASKS_CACHE = 100;

/**
 * 任务存储层只负责生命周期和内存中的状态管理。
 * 这样 TaskManager 本体可以聚焦“如何执行任务”，
 * 而不是同时理解缓存淘汰、统计和状态流转。
 */
export class TaskStore {
  private readonly tasks = new Map<string, Task>();
  private readonly taskAccessOrder: string[] = [];

  createTask(request: ChatRequest): Task {
    const taskId = generateId();
    const currentTime = now();
    const toolingMode: ToolingMode = request.enableTools ? 'experimental' : 'disabled';

    const task: Task = {
      id: taskId,
      type: this.determineTaskType(request),
      status: 'pending',
      userMessage: request.messages[request.messages.length - 1]?.content || '',
      steps: [],
      createdAt: currentTime,
      updatedAt: currentTime,
      metadata: {
        temperature: request.temperature ?? 0.7,
        toolingMode,
      },
    };

    this.cleanupOldTasks();
    this.tasks.set(taskId, task);
    this.taskAccessOrder.push(taskId);

    logger.info('Task created', { taskId, type: task.type });
    return task;
  }

  prepareTaskForExecution(taskId: string): { task?: Task; error?: string } {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { error: 'Task not found' };
    }

    this.touchTask(taskId);

    if (task.status === 'running') {
      return { error: 'Task is already running' };
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return { error: 'Task has already been executed' };
    }

    task.status = 'running';
    task.updatedAt = now();

    return { task };
  }

  getTask(taskId: string): Task | undefined {
    this.touchTask(taskId);
    return this.tasks.get(taskId);
  }

  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  deleteTask(taskId: string): boolean {
    const index = this.taskAccessOrder.indexOf(taskId);
    if (index > -1) {
      this.taskAccessOrder.splice(index, 1);
    }
    return this.tasks.delete(taskId);
  }

  addStep(taskId: string, step: Step): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.steps.push(step);
      task.updatedAt = now();
    }
  }

  updateMetadata(taskId: string, metadata: TaskMetadata): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.metadata = {
      ...task.metadata,
      ...metadata,
    };
    task.updatedAt = now();
  }

  setResult(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.result = result;
    task.updatedAt = now();
  }

  markCompleted(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return;
    }

    task.status = 'completed';
    task.updatedAt = now();
  }

  markFailed(taskId: string, error: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    task.status = 'failed';
    task.error = error;
    task.updatedAt = now();
    return true;
  }

  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      total: tasks.length,
      pending: tasks.filter((task) => task.status === 'pending').length,
      running: tasks.filter((task) => task.status === 'running').length,
      completed: tasks.filter((task) => task.status === 'completed').length,
      failed: tasks.filter((task) => task.status === 'failed').length,
    };
  }

  private determineTaskType(request: ChatRequest): Task['type'] {
    if (request.images?.length) return 'image';
    if (request.files?.length) return 'file';
    if (request.enableTools) return 'code';
    return 'chat';
  }

  /**
   * 这里保留简单的 LRU 思路，是为了限制内存占用，
   * 但只淘汰已结束任务，避免正在流式返回的任务被误删。
   */
  private cleanupOldTasks(): void {
    if (this.tasks.size < MAX_TASKS_CACHE) {
      return;
    }

    const removeCount = Math.floor(MAX_TASKS_CACHE * 0.2);
    const toRemove = this.taskAccessOrder.splice(0, removeCount);

    for (const taskId of toRemove) {
      const task = this.tasks.get(taskId);
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        this.tasks.delete(taskId);
        logger.debug('Cleaned up old task', { taskId });
      }
    }

    logger.info('Cleaned up old tasks', { removed: toRemove.length });
  }

  private touchTask(taskId: string): void {
    const index = this.taskAccessOrder.indexOf(taskId);
    if (index > -1) {
      this.taskAccessOrder.splice(index, 1);
      this.taskAccessOrder.push(taskId);
    }
  }
}
