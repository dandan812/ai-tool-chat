/**
 * Task Manager
 * 管理 Task 生命周期，协调 Step 执行
 */
import type { Task, Step, TaskStatus, StepStatus, StepType, ChatRequest, Env } from '../types';
import { selectSkill, getSkill } from '../skills';
import { createMCPClient } from '../mcp/client';
import { generateId } from '../utils/id';

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * 创建新 Task
   */
  createTask(request: ChatRequest): Task {
    const taskId = generateId();
    const now = Date.now();

    const task: Task = {
      id: taskId,
      type: this.determineTaskType(request),
      status: 'pending',
      userMessage: request.messages[request.messages.length - 1]?.content || '',
      steps: [],
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * 确定 Task 类型
   */
  private determineTaskType(request: ChatRequest): Task['type'] {
    if (request.images && request.images.length > 0) return 'image';
    if (request.files && request.files.length > 0) return 'file';
    if (request.enableTools) return 'code';
    return 'chat';
  }

  /**
   * 执行 Task
   */
  async *executeTask(taskId: string, request: ChatRequest): AsyncIterable<{
    type: 'task' | 'step' | 'content' | 'error' | 'complete';
    data: unknown;
  }> {
    const task = this.tasks.get(taskId);
    if (!task) {
      yield { type: 'error', data: { message: 'Task not found' } };
      return;
    }

    // 更新 Task 状态
    task.status = 'running';
    task.updatedAt = Date.now();
    yield { type: 'task', data: { task, event: 'started' } };

    try {
      // Step 1: 规划 (Plan)
      const planStep = this.createStep(taskId, 'plan', '分析需求', '理解用户意图并规划执行步骤');
      yield { type: 'step', data: { step: planStep, event: 'start' } };
      
      // 简单规划逻辑
      const needsMultimodal = !!(request.images && request.images.length > 0);
      const needsTools = !!request.enableTools;
      
      planStep.status = 'completed';
      planStep.output = { needsMultimodal, needsTools };
      planStep.completedAt = Date.now();
      yield { type: 'step', data: { step: planStep, event: 'complete' } };

      // Step 2: 执行 Skill
      const skillStep = this.createStep(
        taskId,
        'skill',
        needsMultimodal ? '多模态处理' : '文本对话',
        needsMultimodal ? '调用 Qwen-VL 处理图文' : '调用 DeepSeek 生成回复'
      );
      yield { type: 'step', data: { step: skillStep, event: 'start' } };

      // 选择并执行 Skill
      const skill = selectSkill(request);
      const mcpClient = createMCPClient();

      let fullContent = '';

      for await (const chunk of skill.execute(
        {
          messages: request.messages,
          images: request.images,
          files: request.files,
          temperature: request.temperature,
        },
        {
          taskId,
          stepId: skillStep.id,
          env: this.env,
          mcpClient,
        }
      )) {
        if (chunk.type === 'content') {
          fullContent += chunk.content;
          yield { type: 'content', data: { content: chunk.content } };
        } else if (chunk.type === 'error') {
          skillStep.status = 'failed';
          skillStep.error = chunk.error;
          yield { type: 'step', data: { step: skillStep, event: 'error' } };
          throw new Error(chunk.error);
        }
      }

      skillStep.status = 'completed';
      skillStep.output = { content: fullContent };
      skillStep.completedAt = Date.now();
      yield { type: 'step', data: { step: skillStep, event: 'complete' } };

      // Step 3: 响应 (Respond)
      const respondStep = this.createStep(taskId, 'respond', '生成响应', '整理并返回最终结果');
      yield { type: 'step', data: { step: respondStep, event: 'start' } };

      task.result = fullContent;
      task.status = 'completed';
      task.updatedAt = Date.now();

      respondStep.status = 'completed';
      respondStep.output = { result: fullContent };
      respondStep.completedAt = Date.now();
      yield { type: 'step', data: { step: respondStep, event: 'complete' } };

      // 完成
      yield { type: 'complete', data: { task } };

    } catch (error) {
      task.status = 'failed';
      task.error = String(error);
      task.updatedAt = Date.now();
      yield { type: 'error', data: { error: String(error), task } };
    }
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
      startedAt: Date.now(),
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
    return this.tasks.get(taskId);
  }

  /**
   * 列出所有 Task
   */
  listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }
}
