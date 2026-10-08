import type { ChatMessage, EvidenceSource, Step, Task, TaskMetrics } from '../../types/task'

export function findMessage(messages: ChatMessage[] | undefined, messageId: string) {
  return messages?.find((message) => message.id === messageId)
}

export function mergeSources(current: EvidenceSource[], incoming: EvidenceSource[]) {
  return [...new Map([...current, ...incoming].map((source) => [source.sourceId, source])).values()]
}

export function applyTaskDetails(message: ChatMessage, task: Task) {
  message.taskId = task.id
  if (Array.isArray(task.metadata?.sources)) {
    message.sources = mergeSources(message.sources ?? [], task.metadata.sources as EvidenceSource[])
  }
  if (task.metadata?.metrics && typeof task.metadata.metrics === 'object') {
    message.metrics = task.metadata.metrics as unknown as TaskMetrics
  }
}

export function updateStep(steps: Step[], step: Step): Step[] {
  const index = steps.findIndex((item) => item.id === step.id)
  return index < 0
    ? [...steps, step]
    : steps.map((item, position) => (position === index ? { ...item, ...step } : item))
}

export function appendMessageError(message: ChatMessage, error: string) {
  if (message.content === error || message.content.endsWith(`\n\n${error}`)) return
  message.content = message.content.trim() ? `${message.content}\n\n${error}` : error
}

export function applyTaskSnapshot(message: ChatMessage, task: Task) {
  applyTaskDetails(message, task)
  if (task.status === 'pending' || task.status === 'running') return
  if (task.result !== undefined) message.content = task.result
  if (task.error) appendMessageError(message, task.error)
}
