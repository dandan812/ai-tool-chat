import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { sendTaskRequest } from '../api/task'
import type { ChatMessage, Task, Step, ImageData, UploadedFileRef } from '../types/task'
import { getUserFriendlyError } from '../utils/error'
import {
  buildUserMessageContent,
  debounce,
  estimateStorageSize,
  generateFallbackTitle,
  generateSessionId,
  loadChatStorage,
  MAX_STORAGE_SIZE,
  pruneStoredMessages,
  saveChatStorage,
  STORAGE_SAVE_DEBOUNCE_MS,
  TITLE_MAX_LENGTH,
  type ChatSession,
} from './chatStorage'
import {
  clearSessionRuntimeMaps,
  removeRuntimeSession,
  setRuntimeMapValue,
  upsertSessionStep,
} from './chatRuntime'
import { buildRequestMessages } from './chatRequest'

export const useChatStore = defineStore('chat', () => {
  const sessionList = ref<ChatSession[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const currentSessionId = ref<string>('')
  const isLoading = ref(false)
  const abortController = shallowRef<AbortController | null>(null)
  const storageError = ref<string | null>(null)

  const sessionLoadingMap = ref<Record<string, boolean>>({})
  const currentTaskMap = ref<Record<string, Task | null>>({})
  const stepMap = ref<Record<string, Step[]>>({})
  const streamingContent = ref<{ sessionId: string; index: number; content: string } | null>(null)

  const sessions = computed(() => sessionList.value)
  const currentSession = computed(() =>
    sessionList.value.find((session) => session.id === currentSessionId.value)
  )
  const messages = computed(() => {
    if (!currentSessionId.value) return []
    return messagesMap.value[currentSessionId.value] ?? []
  })

  const saveToStorage = debounce(() => {
    try {
      const data = {
        sessionList: sessionList.value,
        messagesMap: messagesMap.value,
        version: 'v1'
      }

      if (estimateStorageSize(data) > MAX_STORAGE_SIZE) {
        cleanupOldMessages()
      }

      saveChatStorage(sessionList.value, messagesMap.value, currentSessionId.value)
      storageError.value = null
    } catch (error) {
      console.error('Storage save failed:', error)
      storageError.value = getUserFriendlyError(error as Error, '存储失败')
      cleanupOldMessages()
    }
  }, STORAGE_SAVE_DEBOUNCE_MS)

  function cleanupOldMessages(): void {
    messagesMap.value = pruneStoredMessages(sessionList.value, messagesMap.value)
  }

  function createSession(title?: string, initialMessages?: ChatMessage[]): string {
    const id = generateSessionId()
    const now = Date.now()

    const newSession: ChatSession = {
      id,
      title: title?.trim() || '新对话',
      createdAt: now,
      updatedAt: now
    }

    sessionList.value.unshift(newSession)
    messagesMap.value[id] = initialMessages ?? []
    currentTaskMap.value[id] = null
    stepMap.value[id] = []
    currentSessionId.value = id
    saveToStorage()

    return id
  }

  function switchSession(id: string): boolean {
    if (!sessionList.value.some((session) => session.id === id)) return false
    currentSessionId.value = id
    clearStreamingContent()
    saveToStorage()
    return true
  }

  function clearSessionRuntimeState(sessionId: string): void {
    const { nextTaskMap, nextStepMap, nextLoadingMap } = clearSessionRuntimeMaps(
      sessionId,
      currentTaskMap.value,
      stepMap.value,
      sessionLoadingMap.value
    )

    currentTaskMap.value = nextTaskMap
    stepMap.value = nextStepMap
    sessionLoadingMap.value = nextLoadingMap

    if (streamingContent.value?.sessionId === sessionId) {
      streamingContent.value = null
    }
  }

  function deleteSession(id: string): void {
    const index = sessionList.value.findIndex((session) => session.id === id)
    if (index === -1) return

    sessionList.value.splice(index, 1)

    delete messagesMap.value[id]

    currentTaskMap.value = removeRuntimeSession(currentTaskMap.value, id)
    stepMap.value = removeRuntimeSession(stepMap.value, id)
    sessionLoadingMap.value = removeRuntimeSession(sessionLoadingMap.value, id)

    if (id === currentSessionId.value) {
      if (sessionList.value.length > 0) {
        const newIndex = Math.min(index, sessionList.value.length - 1)
        currentSessionId.value = sessionList.value[newIndex]?.id ?? ''
      } else {
        createSession()
      }
    }

    saveToStorage()
  }

  function updateSessionTitle(id: string, title: string): void {
    const session = sessionList.value.find((item) => item.id === id)
    if (!session || !title.trim()) return

    session.title = title.trim().slice(0, TITLE_MAX_LENGTH)
    saveToStorage()
  }

  function addMessage(sessionId: string, message: ChatMessage): void {
    if (!messagesMap.value[sessionId]) {
      messagesMap.value[sessionId] = []
    }

    messagesMap.value[sessionId]!.push(message)

    const session = sessionList.value.find((item) => item.id === sessionId)
    if (session) {
      session.updatedAt = Date.now()
    }

    saveToStorage()
  }

  function deleteMessage(index: number): void {
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value
    const sessionMessages = messagesMap.value[sessionId]
    if (!sessionMessages) return

    sessionMessages.splice(index, 1)
    saveToStorage()
  }

  function clearMessages(): void {
    stopGeneration()
    if (!currentSessionId.value) return

    messagesMap.value[currentSessionId.value] = []
    clearSessionRuntimeState(currentSessionId.value)
    saveToStorage()
  }

  function setStreamingContent(sessionId: string, index: number, content: string) {
    streamingContent.value = { sessionId, index, content }
  }

  function clearStreamingContent() {
    streamingContent.value = null
  }

  function getMessageContent(sessionId: string, index: number, originalContent: string): string {
    if (streamingContent.value?.sessionId === sessionId && streamingContent.value?.index === index) {
      return streamingContent.value.content
    }
    return originalContent
  }

  function setSessionLoading(sessionId: string, loading: boolean) {
    sessionLoadingMap.value = setRuntimeMapValue(sessionLoadingMap.value, sessionId, loading)
  }

  function isSessionLoading(sessionId: string): boolean {
    return sessionLoadingMap.value[sessionId] || false
  }

  function setCurrentTask(sessionId: string, task: Task | null) {
    currentTaskMap.value = setRuntimeMapValue(currentTaskMap.value, sessionId, task)
  }

  function getCurrentTask(sessionId: string): Task | null {
    return currentTaskMap.value[sessionId] ?? null
  }

  function setSteps(sessionId: string, steps: Step[]) {
    stepMap.value = setRuntimeMapValue(stepMap.value, sessionId, steps)
  }

  function upsertStep(sessionId: string, step: Step) {
    stepMap.value = upsertSessionStep(stepMap.value, sessionId, step)
  }

  function getSteps(sessionId: string): Step[] {
    return stepMap.value[sessionId] ?? []
  }

  async function sendTaskMessage(
    content: string,
    images: ImageData[] = [],
    files: UploadedFileRef[] = []
  ): Promise<void> {
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value
    if (isSessionLoading(sessionId)) return

    const userContent = buildUserMessageContent(content, images, files)
    if (!userContent && images.length === 0 && files.length === 0) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: userContent || '[消息]'
    }

    const sessionMessages = messagesMap.value[sessionId] ?? []
    const requestMessages = buildRequestMessages(sessionMessages, userMessage)

    addMessage(sessionId, userMessage)
    addMessage(sessionId, { role: 'assistant', content: '' })

    const assistantIndex = (messagesMap.value[sessionId] ?? []).length - 1

    if (abortController.value) {
      abortController.value.abort()
    }

    abortController.value = new AbortController()
    const requestSignal = abortController.value.signal

    isLoading.value = true
    setSessionLoading(sessionId, true)
    setCurrentTask(sessionId, null)
    setSteps(sessionId, [])
    clearStreamingContent()

    try {
      await sendTaskRequest(
        {
          messages: requestMessages,
          images: images.length > 0 ? images : undefined,
          files: files.length > 0 ? files : undefined,
          temperature: 0.7
        },
        {
          onTaskStart: (task) => {
            setCurrentTask(sessionId, task)
            setSteps(sessionId, [])
          },
          onTaskUpdate: (task) => {
            setCurrentTask(sessionId, task)
          },
          onStepStart: (step) => {
            upsertStep(sessionId, step)
          },
          onStepComplete: (step) => {
            upsertStep(sessionId, step)
          },
          onStepError: (step) => {
            upsertStep(sessionId, step)
          },
          onContent: (chunk) => {
            const sessionMessages = messagesMap.value[sessionId]
            if (!sessionMessages?.[assistantIndex]) return

            sessionMessages[assistantIndex].content += chunk
            if (currentSessionId.value === sessionId) {
              setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          },
          onError: (error) => {
            const sessionMessages = messagesMap.value[sessionId]
            if (!sessionMessages?.[assistantIndex]) return

            const errorMessage = getUserFriendlyError(new Error(error), '出错了，请重试')
            if (sessionMessages[assistantIndex].content.trim()) {
              sessionMessages[assistantIndex].content += `\n\n${errorMessage}`
            } else {
              sessionMessages[assistantIndex].content = errorMessage
            }

            if (currentSessionId.value === sessionId) {
              setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          },
          onComplete: (task) => {
            setCurrentTask(sessionId, task)

            if (requestMessages.length === 1) {
              updateSessionTitle(sessionId, generateFallbackTitle(userMessage.content))
            }
          }
        },
        requestSignal
      )
    } finally {
      if (abortController.value?.signal === requestSignal) {
        abortController.value = null
      }

      isLoading.value = false
      setSessionLoading(sessionId, false)

      if (currentSessionId.value === sessionId) {
        clearStreamingContent()
      }

      saveToStorage()
    }
  }

  function stopGeneration(): void {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }

    isLoading.value = false
    if (currentSessionId.value) {
      setSessionLoading(currentSessionId.value, false)
    }
    clearStreamingContent()
  }

  function init(): void {
    const data = loadChatStorage()

    if (data?.sessionList?.length) {
      sessionList.value = data.sessionList
      messagesMap.value = data.messagesMap
      currentSessionId.value = data.currentSessionId || data.sessionList[0]?.id || ''
    } else {
      createSession()
    }
  }

  init()

  return {
    sessions,
    currentSession,
    messages,
    messagesMap,
    streamingContent,
    currentSessionId,
    isLoading,
    storageError,

    createSession,
    switchSession,
    deleteSession,
    addMessage,
    deleteMessage,
    sendTaskMessage,
    stopGeneration,
    clearChat: clearMessages,
    cleanupOldMessages,
    setStreamingContent,
    clearStreamingContent,
    getMessageContent,
    setSessionLoading,
    isSessionLoading,
    getCurrentTask,
    getSteps
  }
})
