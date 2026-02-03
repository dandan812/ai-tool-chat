/**
 * Task Manager - 优化版
 * 管理 Task 生命周期，协调 Step 执行
 * 添加超时控制、内存管理、错误处理、性能监控
 */
import type { Task, Step, TaskStatus, StepType, ChatRequest, Env } from '../types';
import { selectSkill, getSkill } from '../skills';
import { createMCPClient } from '../mcp/client';
import { generateId, now } from '../utils/id';
import { logger } from '../utils/logger';
import { Cache } from '../utils/cache';

// 常量配置
const TASK_TIMEOUT_MS = 5 * 60 * 1000; // 5分钟超时
const MAX_TASKS_CACHE = 100; // 最大缓存任务数
const STEP_TIMEOUT_MS = 2 * 60 * 1000; // 每个 step 2分钟超时

interface TaskStreamEvent {
  type: 'task' | 'step' | 'content' | 'error' | 'complete';
  data: unknown;
}

export class TaskManager {
  private tasks = new Map<string, Task>();
  private env: Env;
  private taskAccessOrder: string[] = [];
  private taskCache: Cache;

  constructor(env: Env) {
    this.env = env;
    this.taskCache = new Cache({
      defaultTTL: TASK_TIMEOUT_MS,
      maxEntries: MAX_TASKS_CACHE,
    });
  }

  /**
   * 创建新 Task
   */
  createTask(request: ChatRequest): Task {
    const taskId = generateId();
    const currentTime = now();

    const task: Task = {
      id: taskId,
      type: this.determineTaskType(request),
      status: 'pending',
      userMessage: request.messages[request.messages.length - 1]?.content || '',
      steps: [],
      createdAt: currentTime,
      updatedAt: currentTime,
    };

    // 内存管理：限制任务缓存数量
    this.cleanupOldTasks();

    this.tasks.set(taskId, task);
    this.taskAccessOrder.push(taskId);

    logger.info('Task created', { taskId, type: task.type });
    return task;
  }

  /**
   * 确定 Task 类型
   */
  private determineTaskType(request: ChatRequest): Task['type'] {
    if (request.images?.length) return 'image';
    if (request.files?.length) return 'file';
    if (request.enableTools) return 'code';
    return 'chat';
  }

  /**
   * 清理旧任务 (LRU)
   */
  private cleanupOldTasks(): void {
    if (this.tasks.size < MAX_TASKS_CACHE) return;

    // 移除最旧的 20% 任务
    const removeCount = Math.floor(MAX_TASKS_CACHE * 0.2);
    const toRemove = this.taskAccessOrder.splice(0, removeCount);

    for (const taskId of toRemove) {
      const task = this.tasks.get(taskId);
      if (task) {
        // 只清理已完成的任务
        if (task.status === 'completed' || task.status === 'failed') {
          this.tasks.delete(taskId);
          logger.debug('Cleaned up old task', { taskId });
        }
      }
    }

    logger.info('Cleaned up old tasks', { removed: toRemove.length });
  }

  /**
   * 更新任务访问顺序
   */
  private touchTask(taskId: string): void {
    const index = this.taskAccessOrder.indexOf(taskId);
    if (index > -1) {
      this.taskAccessOrder.splice(index, 1);
      this.taskAccessOrder.push(taskId);
    }
  }

  /**
   * 执行 Task (带超时控制)
   */
  async *executeTask(
    taskId: string,
    request: ChatRequest
  ): AsyncIterable<TaskStreamEvent> {
    const task = this.tasks.get(taskId);
    if (!task) {
      yield { type: 'error', data: { error: 'Task not found' } };
      return;
    }

    this.touchTask(taskId);

    // 检查任务是否已在运行
    if (task.status === 'running') {
      yield { type: 'error', data: { error: 'Task is already running' } };
      return;
    }

    // 检查任务是否已完成
    if (task.status === 'completed' || task.status === 'failed') {
      yield { type: 'error', data: { error: 'Task has already been executed' } };
      return;
    }

    // 更新 Task 状态
    task.status = 'running';
    task.updatedAt = now();
    yield { type: 'task', data: { task, event: 'started' } };

    const startTime = now();
    const timeoutId = this.createTimeout(taskId, TASK_TIMEOUT_MS);

    try {
      // 执行 Task Steps
      for await (const event of this.runTaskSteps(task, request)) {
        yield event;
      }

      clearTimeout(timeoutId);

      // 标记完成
      if (task.status === 'running') {
        task.status = 'completed';
        task.updatedAt = now();
      }

      const duration = now() - startTime;
      logger.info('Task completed', { taskId, duration });
    } catch (error) {
      clearTimeout(timeoutId);

      logger.error('Task execution failed', { taskId, error });
      task.status = 'failed';
      task.error = String(error);
      task.updatedAt = now();
      yield { type: 'error', data: { error: String(error), task } };
    }
  }

  /**
   * 创建超时定时器
   */
  private createTimeout(taskId: string, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (task && task.status === 'running') {
        logger.error('Task timeout', { taskId });
        task.status = 'failed';
        task.error = 'Task execution timeout';
        task.updatedAt = now();
      }
    }, ms);
  }

  /**
   * 执行 Task Steps
   */
  private async *runTaskSteps(
    task: Task,
    request: ChatRequest
  ): AsyncIterable<TaskStreamEvent> {
    const taskId = task.id;

    // Step 1: 规划 (Plan)
    yield* this.runPlanStep(taskId, request);

    // Step 2: 执行 Skill
    const skillResult = yield* this.runSkillStep(taskId, request);
    if (!skillResult.success) {
      throw new Error(skillResult.error);
    }

    // Step 3: 响应 (Respond)
    yield* this.runRespondStep(taskId, skillResult.content);

    // 完成
    task.result = skillResult.content;
    task.updatedAt = now();
    yield { type: 'complete', data: { task } };

    logger.info('Task completed', { taskId });
  }

  /**
   * 规划 Step
   */
  private async *runPlanStep(
    taskId: string,
    request: ChatRequest
  ): AsyncIterable<TaskStreamEvent> {
    const step = this.createStep(
      taskId,
      'plan',
      '分析需求',
      '理解用户意图并规划执行步骤'
    );
    yield { type: 'step', data: { step, event: 'start' } };

    try {
      const needsMultimodal = !!(request.images?.length);
      const needsTools = !!request.enableTools;

      step.status = 'completed';
      step.output = { needsMultimodal, needsTools };
      step.completedAt = now();
      yield { type: 'step', data: { step, event: 'complete' } };
    } catch (error) {
      step.status = 'failed';
      step.error = String(error);
      throw error;
    }
  }

  /**
   * Skill Step
   */
  private async *runSkillStep(
    taskId: string,
    request: ChatRequest
  ): AsyncIterable<
    TaskStreamEvent,
    { success: boolean; content: string; error?: string }
  > {
    const needsMultimodal = !!(request.images?.length);
    const step = this.createStep(
      taskId,
      'skill',
      needsMultimodal ? '多模态处理' : '文本对话',
      needsMultimodal ? '调用 Qwen-VL 处理图文' : '调用 DeepSeek 生成回复'
    );
    yield { type: 'step', data: { step, event: 'start' } };

    const skill = selectSkill(request);
    const mcpClient = createMCPClient();
    let fullContent = '';

    try {
      const skillExecution = skill.execute(
        {
          messages: request.messages,
          images: request.images,
          files: request.files,
          temperature: request.temperature,
        },
        {
          taskId,
          stepId: step.id,
          env: this.env,
          mcpClient,
        }
      );

      for await (const chunk of skillExecution) {
        if (chunk.type === 'content') {
          fullContent += chunk.content;
          yield { type: 'content', data: { content: chunk.content } };
        } else if (chunk.type === 'error') {
          throw new Error(chunk.error);
        }
      }

      step.status = 'completed';
      step.output = { content: fullContent };
      step.completedAt = now();
      yield { type: 'step', data: { step, event: 'complete' } };

      return { success: true, content: fullContent };
    } catch (error) {
      step.status = 'failed';
      step.error = String(error);
      yield { type: 'step', data: { step, event: 'error' } };
      return { success: false, content: '', error: String(error) };
    }
  }

  /**
   * 响应 Step
   */
  private async *runRespondStep(
    taskId: string,
    result: string
  ): AsyncIterable<TaskStreamEvent> {
    const step = this.createStep(
      taskId,
      'respond',
      '生成响应',
      '整理并返回最终结果'
    );
    yield { type: 'step', data: { step, event: 'start' } };

    step.status = 'completed';
    step.output = { result };
    step.completedAt = now();
    yield { type: 'step', data: { step, event: 'complete' } };
  }

  /**
   * 创建 Step
   */
  private createStep(
    taskId: string,
    type: StepType,
    name: string,
    description?: string
  ): Step {
    const step: Step = {
      id: generateId(),
      taskId,
      type,
      status: 'running',
      name,
      description,
      startedAt: now(),
    };

    const task = this.tasks.get(taskId);
    if (task) {
      task.steps.push(step);
    }

    return step;
  }

  /**
   * 获取 Task
   */
  getTask(taskId: string): Task | undefined {
    this.touchTask(taskId);
    return this.tasks.get(taskId);
  }

  /**
   * 列出所有 Task
   */
  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 删除 Task
   */
  deleteTask(taskId: string): boolean {
    const index = this.taskAccessOrder.indexOf(taskId);
    if (index > -1) {
      this.taskAccessOrder.splice(index, 1);
    }
    return this.tasks.delete(taskId);
  }

  /**
   * 获取统计信息
   */
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
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
    };
  }
}
