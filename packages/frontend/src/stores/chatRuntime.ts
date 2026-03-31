import type { Step, Task } from '../types/task'

export function setRuntimeMapValue<T>(
  currentMap: Record<string, T>,
  sessionId: string,
  value: T,
): Record<string, T> {
  return {
    ...currentMap,
    [sessionId]: value
  }
}

export function removeRuntimeSession<T>(
  currentMap: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  const nextMap = { ...currentMap }
  delete nextMap[sessionId]
  return nextMap
}

export function clearSessionRuntimeMaps(
  sessionId: string,
  currentTaskMap: Record<string, Task | null>,
  stepMap: Record<string, Step[]>,
  sessionLoadingMap: Record<string, boolean>,
): {
  nextTaskMap: Record<string, Task | null>
  nextStepMap: Record<string, Step[]>
  nextLoadingMap: Record<string, boolean>
} {
  return {
    nextTaskMap: setRuntimeMapValue(currentTaskMap, sessionId, null),
    nextStepMap: setRuntimeMapValue(stepMap, sessionId, []),
    nextLoadingMap: setRuntimeMapValue(sessionLoadingMap, sessionId, false)
  }
}

export function upsertSessionStep(
  currentMap: Record<string, Step[]>,
  sessionId: string,
  step: Step,
): Record<string, Step[]> {
  const currentSteps = currentMap[sessionId] ?? []
  const index = currentSteps.findIndex((item) => item.id === step.id)
  const nextSteps = [...currentSteps]

  if (index === -1) {
    nextSteps.push(step)
  } else {
    nextSteps[index] = { ...nextSteps[index], ...step }
  }

  return {
    ...currentMap,
    [sessionId]: nextSteps
  }
}
