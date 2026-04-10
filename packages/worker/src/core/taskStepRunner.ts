import type { ChatRequest, Env, Step, StepType, Task } from '../types';
import { selectSkill, type SelectedSkill } from '../skills';
import { createMCPClient } from '../mcp/client';
import { generateId, now } from '../utils/id';
import type { SkillExecutionResult, TaskStreamEvent } from './taskManagerTypes';
import { TaskStore } from './taskStore';

/**
 * StepRunner 负责真正的任务编排：
 * 先规划，再执行 Skill，最后生成响应步骤。
 * 这样新人在读 TaskManager 时，只需要知道“它把执行委托给谁”，
 * 不必同时理解每一步如何产出事件。
 */
export class TaskStepRunner {
  constructor(
    private readonly env: Env,
    private readonly taskStore: TaskStore,
  ) {}

  async *run(task: Task, request: ChatRequest): AsyncGenerator<TaskStreamEvent, string, void> {
    const selectedSkill = selectSkill(request, this.env);

    this.taskStore.updateMetadata(task.id, {
      model: selectedSkill.model,
      skill: selectedSkill.skill.name,
      toolingMode: request.enableTools ? 'experimental' : 'disabled',
    });

    yield* this.runPlanStep(task.id, request, selectedSkill);

    const skillResult = yield* this.runSkillStep(task, request, selectedSkill);
    if (!skillResult.success) {
      throw new Error(skillResult.error);
    }

    yield* this.runRespondStep(task.id, skillResult.content);

    this.taskStore.setResult(task.id, skillResult.content);
    this.taskStore.updateMetadata(task.id, {
      processingTime: now() - task.createdAt,
    });

    yield { type: 'complete', data: { task } };
    return skillResult.content;
  }

  private async *runPlanStep(
    taskId: string,
    request: ChatRequest,
    selectedSkill: SelectedSkill,
  ): AsyncGenerator<TaskStreamEvent> {
    const step = this.createStep(
      taskId,
      'plan',
      '分析需求',
      '理解用户意图并规划执行步骤',
    );
    yield { type: 'step', data: { step, event: 'start' } };

    try {
      step.status = 'completed';
      step.output = {
        needsMultimodal: !!request.images?.length,
        needsTools: !!request.enableTools,
        toolingMode: request.enableTools ? 'experimental' : 'disabled',
        selectedSkill: selectedSkill.skill.name,
        model: selectedSkill.model,
      };
      step.completedAt = now();
      yield { type: 'step', data: { step, event: 'complete' } };
    } catch (error) {
      step.status = 'failed';
      step.error = String(error);
      throw error;
    }
  }

  private async *runSkillStep(
    task: Task,
    request: ChatRequest,
    selectedSkill: SelectedSkill,
  ): AsyncGenerator<TaskStreamEvent, SkillExecutionResult, void> {
    const step = this.createStep(
      task.id,
      'skill',
      selectedSkill.label,
      selectedSkill.description,
    );
    yield { type: 'step', data: { step, event: 'start' } };

    const skill = selectedSkill.skill;
    const mcpClient = createMCPClient();
    let fullContent = '';

    try {
      const skillExecution = skill.execute(
        {
          messages: request.messages,
          images: request.images,
          files: request.files,
          temperature: request.temperature,
          model: selectedSkill.model,
        },
        {
          taskId: task.id,
          stepId: step.id,
          env: this.env,
          mcpClient,
        },
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
      step.output = {
        content: fullContent,
        model: selectedSkill.model,
        skill: skill.name,
        toolingMode: selectedSkill.toolingMode,
      };
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

  private async *runRespondStep(
    taskId: string,
    result: string,
  ): AsyncGenerator<TaskStreamEvent> {
    const step = this.createStep(
      taskId,
      'respond',
      '生成响应',
      '整理并返回最终结果',
    );
    yield { type: 'step', data: { step, event: 'start' } };

    step.status = 'completed';
    step.output = { result };
    step.completedAt = now();
    yield { type: 'step', data: { step, event: 'complete' } };
  }

  private createStep(
    taskId: string,
    type: StepType,
    name: string,
    description?: string,
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

    this.taskStore.addStep(taskId, step);
    return step;
  }
}
