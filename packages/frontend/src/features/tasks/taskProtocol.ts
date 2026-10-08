import type { EvidenceSource, Step, Task } from '../../types/task'

export class TaskProtocolError extends Error {
  constructor() {
    super('任务事件格式或顺序异常。已停止查看，可从任务中心重新打开。')
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function oneOf(value: unknown, choices: string[]) {
  return typeof value === 'string' && choices.includes(value)
}

function isUsage(value: unknown) {
  return record(value) &&
    nonempty(value.callId) &&
    nonempty(value.model) &&
    oneOf(value.tokenSource, ['provider', 'estimated', 'unknown']) &&
    oneOf(value.outcome, ['completed', 'failed', 'cancelled', 'unknown']) &&
    ['inputTokens', 'outputTokens'].every((key) =>
      value[key] === undefined ||
      (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    )
}

export function isSource(value: unknown): value is EvidenceSource {
  if (!record(value)) return false
  return (
    ['sourceId', 'fileId', 'fileName', 'fileHash', 'excerpt'].every(
      (key) => typeof value[key] === 'string'
    ) &&
    nonempty(value.sourceId) &&
    ['startLine', 'endLine', 'startOffset', 'endOffset'].every((key) =>
      Number.isSafeInteger(value[key])
    ) &&
    (value.startLine as number) >= 1 &&
    (value.endLine as number) >= (value.startLine as number) &&
    (value.startOffset as number) >= 0 &&
    (value.endOffset as number) >= (value.startOffset as number)
  )
}

function isStep(value: unknown, taskId: string): value is Step {
  if (!record(value)) return false
  return (
    nonempty(value.id) &&
    value.taskId === taskId &&
    typeof value.name === 'string' &&
    oneOf(value.type, ['route', 'skill', 'plan', 'mcp', 'think', 'respond']) &&
    oneOf(value.status, ['pending', 'running', 'completed', 'failed']) &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.description === undefined || typeof value.description === 'string') &&
    (value.startedAt === undefined || finite(value.startedAt)) &&
    (value.completedAt === undefined || finite(value.completedAt)) &&
    (value.progress === undefined ||
      (record(value.progress) &&
        typeof value.progress.message === 'string' &&
        finite(value.progress.current) &&
        finite(value.progress.total)))
  )
}

function isTask(value: unknown, taskId?: string): value is Task {
  if (!record(value)) return false
  return (
    nonempty(value.id) &&
    (!taskId || value.id === taskId) &&
    oneOf(value.type, ['chat', 'code', 'image', 'file']) &&
    oneOf(value.status, ['pending', 'running', 'completed', 'failed', 'cancelled']) &&
    typeof value.userMessage === 'string' &&
    finite(value.createdAt) &&
    finite(value.updatedAt) &&
    Array.isArray(value.steps) &&
    value.steps.every((step) => isStep(step, value.id as string)) &&
    (value.result === undefined || typeof value.result === 'string') &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.metadata === undefined ||
      (record(value.metadata) &&
        (value.metadata.sources === undefined ||
          (Array.isArray(value.metadata.sources) && value.metadata.sources.every(isSource)))))
  )
}

export function readTaskSnapshot(input: unknown, taskId?: string): Task {
  if (!record(input) || !isTask(input.task, taskId)) throw new TaskProtocolError()
  return input.task
}

type EventData =
  | { type: 'content'; data: { content: string } }
  | { type: 'usage'; data: { usage: Record<string, unknown> } }
  | { type: 'sources'; data: { sources: EvidenceSource[] } }
  | { type: 'task' | 'complete'; data: { task: Task } }
  | { type: 'step'; data: { step: Step; event: 'start' | 'progress' | 'complete' | 'error' } }
  | { type: 'error'; data: { error: string; task?: Task } }

export type TaskEvent = EventData & { id: number }

function readEvent(input: unknown, taskId: string): TaskEvent {
  if (
    !record(input) ||
    !Number.isSafeInteger(input.id) ||
    (input.id as number) < 1 ||
    !record(input.data)
  ) {
    throw new TaskProtocolError()
  }
  const data = input.data
  let valid = false
  switch (input.type) {
    case 'content':
      valid = typeof data.content === 'string'
      break
    case 'sources':
      valid = Array.isArray(data.sources) && data.sources.every(isSource)
      break
    case 'usage':
      valid = isUsage(data.usage)
      break
    case 'task':
    case 'complete':
      valid = isTask(data.task, taskId)
      break
    case 'step':
      valid =
        isStep(data.step, taskId) && oneOf(data.event, ['start', 'progress', 'complete', 'error'])
      break
    case 'error':
      valid =
        typeof data.error === 'string' && (data.task === undefined || isTask(data.task, taskId))
      break
  }
  if (!valid) throw new TaskProtocolError()
  return input as TaskEvent
}

export function readEventPage(input: unknown, taskId: string, cursor: number) {
  if (
    !record(input) ||
    !Array.isArray(input.events) ||
    !Number.isSafeInteger(input.lastEventId) ||
    typeof input.terminal !== 'boolean'
  )
    throw new TaskProtocolError()
  const events: TaskEvent[] = []
  const pageEvents = new Map<number, TaskEvent>()
  let nextCursor = cursor
  for (const inputEvent of input.events) {
    const event = readEvent(inputEvent, taskId)
    const duplicate = pageEvents.get(event.id)
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(event))
      throw new TaskProtocolError()
    pageEvents.set(event.id, event)
    if (event.id <= nextCursor) {
      if (event.id > cursor && event.id < nextCursor) throw new TaskProtocolError()
      continue
    }
    if (event.id !== nextCursor + 1) throw new TaskProtocolError()
    events.push(event)
    nextCursor = event.id
  }
  if (input.lastEventId !== nextCursor) throw new TaskProtocolError()
  return { events, lastEventId: nextCursor, terminal: input.terminal }
}
