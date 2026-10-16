import type { ChatRequest, Env, Step, StepType, Task } from '../types'
import { WorkerError } from '../types'
import { selectSkill, type SelectedSkill } from '../skills'
import { generateId, now } from '../utils/id'
import type { TaskStreamEvent } from './taskManagerTypes'
import { TaskStore } from './taskStore'

/** 只负责选择能力、执行能力和转发事件；任务持久化由 DurableTask 负责。 */
export class TaskStepRunner {
  constructor(
    private readonly env: Env,
    private readonly taskStore: TaskStore
  ) {}

  async *run(task: Task, request: ChatRequest): AsyncGenerator<TaskStreamEvent, string, void> {
    const selectedSkill = yield* this.routeRequest(task.id, request)
    const content = yield* this.executeSkill(task.id, request, selectedSkill)
    this.taskStore.setResult(task.id, content)
    this.taskStore.updateMetadata(task.id, {
      processingTime: now() - task.createdAt
    })

    return content
  }

  private async *routeRequest(
    taskId: string,
    request: ChatRequest
  ): AsyncGenerator<TaskStreamEvent, SelectedSkill, void> {
    const step = this.createStep(
      taskId,
      'route',
      '选择处理方式',
      '根据文本、图片或文件输入选择处理能力'
    )
    yield { type: 'step', data: { step, event: 'start' } }

    try {
      this.env.RUNTIME_CONTROL?.signal.throwIfAborted()
      const selectedSkill = selectSkill(request, this.env)
      this.taskStore.updateMetadata(taskId, {
        model: selectedSkill.model,
        skill: selectedSkill.skill.name,
        toolingMode: selectedSkill.toolingMode
      })
      step.status = 'completed'
      step.output = {
        selectedSkill: selectedSkill.skill.name,
        model: selectedSkill.model
      }
      step.completedAt = now()
      yield { type: 'step', data: { step, event: 'complete' } }
      return selectedSkill
    } catch (error) {
      step.status = 'failed'
      step.error = String(error)
      step.completedAt = now()
      yield { type: 'step', data: { step, event: 'error' } }
      throw error
    }
  }

  private async *executeSkill(
    taskId: string,
    request: ChatRequest,
    selectedSkill: SelectedSkill
  ): AsyncGenerator<TaskStreamEvent, string, void> {
    const step = this.createStep(taskId, 'skill', selectedSkill.label, selectedSkill.description)
    yield { type: 'step', data: { step, event: 'start' } }

    const skill = selectedSkill.skill
    let fullContent = ''
    let receivedComplete = false
    const toolSteps = new Map<string, Step>()

    try {
      this.env.RUNTIME_CONTROL?.signal.throwIfAborted()
      const skillExecution = skill.execute(
        {
          messages: request.messages,
          images: request.images,
          files: request.files,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          model: selectedSkill.model
        },
        {
          taskId,
          stepId: step.id,
          env: this.env
        }
      )

      for await (const chunk of skillExecution) {
        this.env.RUNTIME_CONTROL?.signal.throwIfAborted()
        switch (chunk.type) {
          case 'content':
            if (typeof chunk.content !== 'string') {
              throw new WorkerError('Skill emitted invalid content', 'SKILL_INVALID_CONTENT')
            }
            fullContent += chunk.content
            yield { type: 'content', data: { content: chunk.content } }
            break
          case 'progress':
            if (chunk.progress) {
              step.progress = { ...chunk.progress }
              step.description = chunk.progress.message
              yield { type: 'step', data: { step, event: 'progress' } }
            }
            break
          case 'tool_call': {
            const call = chunk.toolCall
            if (!call || toolSteps.has(call.id))
              throw new WorkerError('Invalid tool step', 'AGENT_TOOL_INVALID')
            const label =
              call.name === 'search_files'
                ? '搜索资料'
                : call.name === 'read_file'
                  ? '读取原文'
                  : '检查工具请求'
            const toolStep = this.createStep(taskId, 'mcp', label, label)
            toolStep.input = call.arguments
            toolSteps.set(call.id, toolStep)
            yield { type: 'step', data: { step: toolStep, event: 'start' } }
            break
          }
          case 'tool_result': {
            const result = chunk.toolResult
            const toolStep = result && toolSteps.get(result.toolCallId)
            if (!toolStep || !result)
              throw new WorkerError('Missing tool step', 'AGENT_TOOL_INVALID')
            toolStep.status = result.isError ? 'failed' : 'completed'
            toolStep.description = result.content
            toolStep.completedAt = now()
            if (result.isError) toolStep.error = result.content
            yield {
              type: 'step',
              data: { step: toolStep, event: result.isError ? 'error' : 'complete' }
            }
            break
          }
          case 'sources':
            if (chunk.sources) {
              this.taskStore.updateMetadata(taskId, { sources: chunk.sources })
              yield { type: 'sources', data: { sources: chunk.sources } }
            }
            break
          case 'usage':
            if (chunk.usage) yield { type: 'usage', data: { usage: chunk.usage } }
            break
          case 'complete':
            // 不在这里退出循环：Provider 会在 complete 之后结算并发出 usage。
            receivedComplete = true
            break
          case 'error':
            throw new WorkerError(chunk.error || 'Skill execution failed', 'TASK_EXECUTION_FAILED')
        }
      }

      this.env.RUNTIME_CONTROL?.signal.throwIfAborted()
      if (!receivedComplete) {
        throw new WorkerError('Skill stream ended before completion', 'SKILL_INCOMPLETE')
      }
      step.status = 'completed'
      step.output = {
        model: selectedSkill.model,
        skill: skill.name,
        toolingMode: selectedSkill.toolingMode
      }
      step.completedAt = now()
      yield { type: 'step', data: { step, event: 'complete' } }

      return fullContent
    } catch (error) {
      step.status = 'failed'
      step.error = String(error)
      step.completedAt = now()
      yield { type: 'step', data: { step, event: 'error' } }
      throw error
    }
  }

  private createStep(taskId: string, type: StepType, name: string, description?: string): Step {
    const step: Step = {
      id: generateId(),
      taskId,
      type,
      status: 'running',
      name,
      description,
      startedAt: now()
    }

    this.taskStore.addStep(taskId, step)
    return step
  }
}
