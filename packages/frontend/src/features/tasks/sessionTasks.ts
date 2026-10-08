import { computed, onScopeDispose, ref } from 'vue'
import { apiJSON } from '../../api/account'
import {
  resumeTaskRequest,
  sendTaskRequest,
  type TaskCallbacks,
  type TaskRequest
} from '../../api/task'
import type { ChatMessage, ImageData, Step, Task, UploadedFileRef } from '../../types/task'
import { buildRequestMessages } from '../../stores/chatRequest'
import {
  buildUserMessageContent,
  generateFallbackTitle,
  sanitizeRestoredMessagesMap
} from '../../stores/chatStorage'
import {
  applyTaskSnapshot,
  appendMessageError,
  findMessage,
  mergeSources,
  updateStep
} from '../chat/messageUpdates'
import type { SessionRepository } from '../chat/sessionRepository'
import { readTaskSnapshot, TaskProtocolError } from './taskProtocol'

interface SessionTaskState {
  loading: boolean
  task: Task | null
  steps: Step[]
}
interface Observation {
  controller: AbortController
  messageId: string
  taskId?: string
}

export function createSessionTasks(sessions: SessionRepository) {
  const state = ref<Record<string, SessionTaskState>>({})
  const observations = new Map<string, Observation>()
  const displayMessage = ref<{ sessionId: string; messageId: string } | null>(null)
  const error = ref<string | null>(null)
  const cancellations = new Map<
    string,
    { taskId?: string; controller: AbortController; promise: Promise<void> }
  >()
  let pendingRestore:
    | { taskId: string; controller: AbortController; promise: Promise<void> }
    | undefined

  function sessionState(sessionId: string) {
    return (state.value[sessionId] ??= { loading: false, task: null, steps: [] })
  }

  const streamingContent = computed(() => {
    const display = displayMessage.value
    if (!display || display.sessionId !== sessions.currentSessionId.value) return null
    const items = sessions.messagesMap.value[display.sessionId] ?? []
    const index = items.findIndex((message) => message.id === display.messageId)
    const message = items[index]
    return message ? { sessionId: display.sessionId, index, content: message.content } : null
  })

  function clearStreamingContent() {
    displayMessage.value = null
  }
  function setStreamingContent(sessionId: string, index: number, content: string) {
    const message = sessions.messagesMap.value[sessionId]?.[index]
    if (!message?.id) return
    message.content = content
    displayMessage.value = { sessionId, messageId: message.id }
  }
  function isSessionLoading(sessionId: string) {
    return state.value[sessionId]?.loading ?? false
  }
  function getCurrentTask(sessionId: string) {
    return state.value[sessionId]?.task ?? null
  }
  function getSteps(sessionId: string) {
    return state.value[sessionId]?.steps ?? []
  }
  function setSessionLoading(sessionId: string, loading: boolean) {
    sessionState(sessionId).loading = loading
  }

  function stopObservation(sessionId: string) {
    const observation = observations.get(sessionId)
    observations.delete(sessionId)
    observation?.controller.abort()
    if (state.value[sessionId]) state.value[sessionId].loading = false
    if (displayMessage.value?.sessionId === sessionId) clearStreamingContent()
    sessions.save()
  }

  function stopPendingRestore() {
    pendingRestore?.controller.abort()
    pendingRestore = undefined
  }

  function stopViewing() {
    stopPendingRestore()
    stopObservation(sessions.currentSessionId.value)
  }

  function forgetSession(sessionId: string) {
    stopPendingRestore()
    stopObservation(sessionId)
    delete state.value[sessionId]
    cancellations.get(sessionId)?.controller.abort()
    cancellations.delete(sessionId)
  }

  function resetTransientState() {
    stopPendingRestore()
    for (const sessionId of observations.keys()) stopObservation(sessionId)
    for (const cancellation of cancellations.values()) cancellation.controller.abort()
    cancellations.clear()
    state.value = {}
    clearStreamingContent()
    sessions.messagesMap.value = sanitizeRestoredMessagesMap(sessions.messagesMap.value)
    sessions.save()
  }

  function callbacksFor(
    sessionId: string,
    observation: Observation,
    onComplete?: () => void
  ): TaskCallbacks {
    const ownsObservation = () =>
      sessions.isActive() &&
      observations.get(sessionId) === observation &&
      !observation.controller.signal.aborted
    const message = () =>
      ownsObservation()
        ? findMessage(sessions.messagesMap.value[sessionId], observation.messageId)
        : undefined
    const showMessage = () => {
      if (sessions.currentSessionId.value === sessionId) {
        displayMessage.value = { sessionId, messageId: observation.messageId }
      }
      sessions.save()
    }
    const taskUpdate = (task: Task) => {
      if (!ownsObservation()) return
      observation.taskId = task.id
      const item = message()
      const firstIdentity = item && !item.taskId
      if (item) applyTaskSnapshot(item, task)
      Object.assign(sessionState(sessionId), { task, steps: task.steps })
      if (firstIdentity) sessions.flush()
      else sessions.save()
    }
    const stepUpdate = (step: Step) => {
      if (!ownsObservation()) return
      const current = sessionState(sessionId)
      current.steps = updateStep(current.steps, step)
      if (current.task) current.task.steps = current.steps
    }
    return {
      onTaskStart: taskUpdate,
      onTaskUpdate: taskUpdate,
      onStepStart: stepUpdate,
      onStepProgress: stepUpdate,
      onStepComplete: stepUpdate,
      onStepError: stepUpdate,
      onSources: (sources) => {
        const item = message()
        if (item) {
          item.sources = mergeSources(item.sources ?? [], sources)
          sessions.save()
        }
      },
      onContent: (content) => {
        const item = message()
        if (item) {
          item.content += content
          showMessage()
        }
      },
      onError: (error) => {
        const item = message()
        if (item) {
          appendMessageError(item, error)
          showMessage()
        }
      },
      onComplete: (task) => {
        if (!ownsObservation()) return
        taskUpdate(task)
        const item = message()
        if (item && task.result !== undefined) item.content = task.result
        onComplete?.()
        showMessage()
      }
    }
  }

  async function observe(
    sessionId: string,
    messageId: string,
    request: TaskRequest | string,
    onComplete?: () => void
  ) {
    stopObservation(sessionId)
    const observation: Observation = {
      controller: new AbortController(),
      messageId,
      taskId: typeof request === 'string' ? request : undefined
    }
    observations.set(sessionId, observation)
    sessionState(sessionId).loading = true
    const callbacks = callbacksFor(sessionId, observation, onComplete)
    try {
      if (typeof request === 'string')
        await resumeTaskRequest(request, callbacks, observation.controller.signal)
      else await sendTaskRequest(request, callbacks, observation.controller.signal)
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error.message : '任务连接中断')
    } finally {
      // A replaced observation cannot clear state owned by its replacement.
      if (observations.get(sessionId) === observation) {
        observations.delete(sessionId)
        sessionState(sessionId).loading = false
        if (displayMessage.value?.sessionId === sessionId) clearStreamingContent()
        sessions.save()
      }
    }
  }

  async function sendTaskMessage(
    content: string,
    images: ImageData[] = [],
    files: UploadedFileRef[] = []
  ) {
    const sessionId = sessions.currentSessionId.value
    if (!sessions.isActive() || !sessionId || isSessionLoading(sessionId)) return
    const userContent = buildUserMessageContent(content, images, files)
    if (!userContent) return
    stopPendingRestore()
    error.value = null
    const userMessage: ChatMessage = { role: 'user', content: userContent }
    const messages = buildRequestMessages(sessions.messagesMap.value[sessionId] ?? [], userMessage)
    sessions.addMessage(sessionId, userMessage)
    const requestKey = crypto.randomUUID()
    const messageId = sessions.addMessage(sessionId, { role: 'assistant', content: '', requestKey })
    if (!messageId) return
    Object.assign(sessionState(sessionId), { task: null, steps: [] })
    sessions.flush()
    await observe(
      sessionId,
      messageId,
      {
        messages,
        requestKey,
        temperature: 0.7,
        images: images.length ? images : undefined,
        files: files.length ? files : undefined
      },
      () => {
        if (messages.length === 1)
          sessions.updateSessionTitle(sessionId, generateFallbackTitle(userContent))
      }
    )
  }

  function stopGeneration(): Promise<void> {
    const sessionId = sessions.currentSessionId.value
    if (!sessions.isActive()) return Promise.resolve()
    const pending = cancellations.get(sessionId)
    const taskId = getCurrentTask(sessionId)?.id
    if (pending && pending.taskId === taskId) return pending.promise
    pending?.controller.abort()
    const controller = new AbortController()
    const promise = cancelGeneration(sessionId, controller)
    cancellations.set(sessionId, { taskId, controller, promise })
    void promise.finally(() => {
      if (cancellations.get(sessionId)?.controller === controller) cancellations.delete(sessionId)
    })
    return promise
  }

  async function cancelGeneration(sessionId: string, controller: AbortController) {
    const observation = observations.get(sessionId)
    const task = getCurrentTask(sessionId)
    if (!task && observation) {
      error.value = '任务正在创建，尚无法确认后台取消。请稍后重试。'
      return
    }
    if (!task || !['pending', 'running'].includes(task.status)) {
      stopObservation(sessionId)
      return
    }
    try {
      const response = await apiJSON<unknown>('/tasks/' + encodeURIComponent(task.id) + '/cancel', {
        method: 'POST',
        body: '{}',
        signal: controller.signal
      })
      if (
        !sessions.isActive() ||
        controller.signal.aborted ||
        getCurrentTask(sessionId)?.id !== task.id ||
        observations.get(sessionId) !== observation
      )
        return
      const cancelled = readTaskSnapshot(response, task.id)
      if (cancelled.status === 'pending' || cancelled.status === 'running')
        throw new TaskProtocolError()
      const messageId =
        observation?.messageId ??
        sessions.messagesMap.value[sessionId]?.find((message) => message.taskId === task.id)?.id
      const item = messageId
        ? findMessage(sessions.messagesMap.value[sessionId], messageId)
        : undefined
      if (item) applyTaskSnapshot(item, cancelled)
      Object.assign(sessionState(sessionId), { task: cancelled, steps: cancelled.steps })
      error.value = null
      stopObservation(sessionId)
    } catch (error) {
      if (
        !sessions.isActive() ||
        controller.signal.aborted ||
        getCurrentTask(sessionId)?.id !== task.id ||
        observations.get(sessionId) !== observation
      )
        return
      setError(error, '取消失败，请从任务中心重试。')
    }
  }

  function restoreTask(taskId: string): Promise<void> {
    if (!sessions.isActive()) return Promise.resolve()
    const active = [...observations.entries()].find(
      ([, observation]) => observation.taskId === taskId
    )
    if (active) {
      sessions.select(active[0])
      return Promise.resolve()
    }
    if (pendingRestore?.taskId === taskId) return pendingRestore.promise
    stopPendingRestore()
    error.value = null
    const controller = new AbortController()
    const selectionVersion = sessions.selectionVersion.value
    const promise = restore(controller, taskId, selectionVersion)
    pendingRestore = { taskId, controller, promise }
    return promise
  }

  async function restore(controller: AbortController, taskId: string, selectionVersion: number) {
    try {
      const response = await apiJSON<unknown>('/tasks/' + encodeURIComponent(taskId), {
        signal: controller.signal
      })
      if (
        !sessions.isActive() ||
        controller.signal.aborted ||
        selectionVersion !== sessions.selectionVersion.value
      )
        return
      const task = readTaskSnapshot(response, taskId)
      let sessionId = ''
      let messageId = ''
      for (const [id, items] of Object.entries(sessions.messagesMap.value)) {
        const found = items.find(
          (message) => message.role === 'assistant' && message.taskId === task.id
        )
        if (found?.id) {
          sessionId = id
          messageId = found.id
          break
        }
      }
      if (!sessionId) {
        sessionId = sessions.createSession(generateFallbackTitle(task.userMessage), [
          { role: 'user', content: task.userMessage },
          { role: 'assistant', content: '', taskId: task.id }
        ])
        messageId = sessions.messagesMap.value[sessionId]![1]!.id!
      } else sessions.select(sessionId)
      stopObservation(sessionId)
      const item = findMessage(sessions.messagesMap.value[sessionId], messageId)!
      applyTaskSnapshot(item, task)
      Object.assign(sessionState(sessionId), { task, steps: task.steps })
      if (!['pending', 'running'].includes(task.status)) {
        sessions.save()
        return
      }
      // A replay starts at zero, so rebuild instead of appending to a partial snapshot.
      item.content = ''
      sessions.flush()
      if (pendingRestore?.controller === controller) pendingRestore = undefined
      await observe(sessionId, messageId, task.id)
    } catch (error) {
      if (
        sessions.isActive() &&
        !controller.signal.aborted &&
        selectionVersion === sessions.selectionVersion.value
      ) {
        setError(error, '恢复任务失败')
      }
    } finally {
      if (pendingRestore?.controller === controller) pendingRestore = undefined
    }
  }

  function setError(cause: unknown, fallback: string) {
    error.value = cause instanceof Error ? cause.message : fallback
  }

  async function restoreActiveTask() {
    const last = [...sessions.messages.value]
      .reverse()
      .find((message) => message.role === 'assistant')
    if (last?.taskId) await restoreTask(last.taskId)
    else if (last?.requestKey) {
      error.value = '上次请求是否创建成功尚未确认，请在任务中心查看。不会自动重新发送。'
    }
  }

  onScopeDispose(resetTransientState)
  return {
    streamingContent,
    isLoading: computed(() => isSessionLoading(sessions.currentSessionId.value)),
    setStreamingContent,
    clearStreamingContent,
    setSessionLoading,
    isSessionLoading,
    getCurrentTask,
    getSteps,
    sendTaskMessage,
    restoreTask,
    restoreActiveTask,
    stopGeneration,
    stopViewing,
    stopObservation,
    forgetSession,
    resetTransientState,
    error,
    isObservedMessage(sessionId: string, messageId: string | undefined) {
      return !!messageId && observations.get(sessionId)?.messageId === messageId
    },
    getMessageContent(sessionId: string, index: number, originalContent: string) {
      const display = streamingContent.value
      return display?.sessionId === sessionId && display.index === index
        ? display.content
        : originalContent
    }
  }
}
