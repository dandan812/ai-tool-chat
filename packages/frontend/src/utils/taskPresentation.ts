import type { Step, Task } from '../types/task'

const STEP_TYPE_LABELS: Record<string, string> = {
  plan: '分析请求',
  skill: '调用模型',
  mcp: '执行工具',
  think: '组织回答',
  respond: '生成内容',
}

const MODEL_LABELS: Record<string, string> = {
  'qwen3.5-plus': 'Qwen 3.5 Plus',
  'qwen3.5-flash': 'Qwen 3.5 Flash',
  'qwen3.5-flash-2026-02-23': 'Qwen 3.5 Flash',
  'qwen3.5-122b-a10b': 'Qwen 3.5 122B',
  'qwen3-vl-flash-2026-01-22': 'Qwen 3 VL Flash',
  'qwen3-max-2026-01-23': 'Qwen 3 Max',
  'qwen3-vl-plus': 'Qwen VL Plus',
  'qwen-vl-plus': 'Qwen VL Plus',
  'kimi-k2.5': 'Kimi K2.5',
  'MiniMax-M2.5': 'MiniMax M2.5',
  'MiniMax-M2.1': 'MiniMax M2.1',
  'qwen3-coder-next': 'Qwen 3 Coder Next',
  'qwen3.5-397b-a17b': 'Qwen 3.5 397B',
  'qwen-flash-character': 'Qwen Flash Character',
  'qwen-flash-character-2026-01-22': 'Qwen Flash Character',
}

export function getStepTypeLabel(type: string, fallback: string): string {
  return STEP_TYPE_LABELS[type] || fallback
}

export function getTaskModelLabel(task: Task | null, steps: Step[]): string {
  const taskModel = task?.metadata?.model
  if (typeof taskModel === 'string' && taskModel) {
    return MODEL_LABELS[taskModel] || taskModel
  }

  const skillStep = steps.find((step) => step.type === 'skill')
  const outputModel =
    skillStep?.output && typeof skillStep.output === 'object'
      ? (skillStep.output as Record<string, unknown>).model
      : null

  return typeof outputModel === 'string' && outputModel
    ? MODEL_LABELS[outputModel] || outputModel
    : '等待调度'
}

export function getActiveStep(steps: Step[]): Step | null {
  return steps.find((step) => step.status === 'running') ?? steps[steps.length - 1] ?? null
}

export function getTaskStatusText(task: Task | null, steps: Step[]): string {
  if (!task) return '等待执行'
  if (task.status === 'failed') return '执行失败'
  if (task.status === 'completed') return '已完成'
  return getActiveStep(steps) ? '执行中' : '准备中'
}

export function getActiveStepText(steps: Step[]): string {
  const activeStep = getActiveStep(steps)
  if (!activeStep) return '等待新的任务开始'

  if (activeStep.description) {
    return activeStep.description
  }

  return getStepTypeLabel(activeStep.type, activeStep.name)
}

export function getCompletedStepCount(steps: Step[]): number {
  return steps.filter((step) => step.status === 'completed').length
}

export function getTaskDurationSeconds(steps: Step[]): number {
  if (!steps.length) return 0

  const firstStep = steps[0]
  const lastStep = steps[steps.length - 1]
  const start = firstStep?.startedAt || 0
  const end = lastStep?.completedAt || Date.now()

  return Math.max(0, Math.round((end - start) / 1000))
}

export function formatTaskDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`

  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes} 分 ${remainSeconds} 秒`
}
