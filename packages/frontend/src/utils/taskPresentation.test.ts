import { describe, expect, it } from 'vitest';
import type { Step, Task } from '../types/task';
import {
  formatTaskDuration,
  getActiveStep,
  getActiveStepText,
  getCompletedStepCount,
  getTaskModelLabel,
  getTaskStatusText,
} from './taskPresentation';

const baseTask: Task = {
  id: 'task-1',
  type: 'chat',
  status: 'running',
  userMessage: 'hello',
  steps: [],
  createdAt: 1000,
  updatedAt: 1000,
  metadata: {},
};

const steps: Step[] = [
  {
    id: 'step-1',
    taskId: 'task-1',
    type: 'plan',
    status: 'completed',
    name: '分析请求',
    startedAt: 1000,
    completedAt: 1500,
  },
  {
    id: 'step-2',
    taskId: 'task-1',
    type: 'skill',
    status: 'running',
    name: '调用模型',
    description: '正在生成回答',
    startedAt: 1500,
  },
];

describe('taskPresentation', () => {
  it('应该返回当前活动步骤', () => {
    expect(getActiveStep(steps)?.id).toBe('step-2');
  });

  it('应该优先使用 task.metadata.model 生成模型标签', () => {
    const task = {
      ...baseTask,
      metadata: { model: 'qwen3.5-flash-2026-02-23' },
    };

    expect(getTaskModelLabel(task, steps)).toBe('Qwen 3.5 Flash');
  });

  it('应该在任务运行中返回活动步骤描述', () => {
    expect(getTaskStatusText(baseTask, steps)).toBe('执行中');
    expect(getActiveStepText(steps)).toBe('正在生成回答');
  });

  it('应该统计已完成步骤数', () => {
    expect(getCompletedStepCount(steps)).toBe(1);
  });

  it('应该格式化任务耗时', () => {
    expect(formatTaskDuration(12)).toBe('12 秒');
    expect(formatTaskDuration(61)).toBe('1 分 1 秒');
  });
});
