import type { Step, Task } from '../types/task'

export function setRuntimeMapValue<T>(
  currentMap: Record<string, T>,
  sessionId: string,
  value: T,
): Record<string, T> {
  currentMap[sessionId] = value
  return currentMap
}

export function removeRuntimeSession<T>(
  currentMap: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  delete currentMap[sessionId]
  return currentMap
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

  if (index === -1) {
    currentSteps.push(step)
  } else {
    currentSteps[index] = { ...currentSteps[index], ...step }
  }

  currentMap[sessionId] = currentSteps
  return currentMap
}
