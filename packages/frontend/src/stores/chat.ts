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
  sanitizeRestoredMessagesMap,
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

/**
 * 聊天主 Store
 *
 * 这是整个前端聊天主链路的“状态中枢”。
 * 页面和组件大多不直接操作底层请求，而是统一通过这里完成：
 *
 * 1. 会话管理
 * 2. 消息持久化
 * 3. 当前任务 / 步骤运行态管理
 * 4. 流式内容展示态管理
 * 5. 请求发送与中止
 *
 * 如果你要理解这个项目的前端，`sendTaskMessage()` 和这份状态结构
 * 是最值得反复阅读的部分。
 */
export const useChatStore = defineStore('chat', () => {
  // ==================== 持久化状态 ====================
  // 这部分会写入 localStorage，用于刷新页面后恢复会话和消息。
  const sessionList = ref<ChatSession[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const currentSessionId = ref<string>('')

  // ==================== 全局运行态 ====================
  // isLoading：当前前端是否存在活跃生成任务
  // abortController：用于中止当前请求
  // storageError：本地存储失败时用于 Toast 提示
  const isLoading = ref(false)
  const abortController = shallowRef<AbortController | null>(null)
  const storageError = ref<string | null>(null)

  // ==================== 按会话维度的运行态 ====================
  // sessionLoadingMap：某个会话当前是否正在生成
  // currentTaskMap：某个会话当前对应的 Task
  // stepMap：某个会话当前收到的步骤列表
  // streamingContent：当前屏幕正在展示的流式内容
  //
  // 为什么按“sessionId -> 状态”存？
  // 因为应用支持多会话切换，不能只保留一份全局消息/任务状态。
  const sessionLoadingMap = ref<Record<string, boolean>>({})
  const currentTaskMap = ref<Record<string, Task | null>>({})
  const stepMap = ref<Record<string, Step[]>>({})
  const streamingContent = ref<{ sessionId: string; index: number; content: string } | null>(null)

  // 对外暴露的只读计算状态。
  const sessions = computed(() => sessionList.value)
  const currentSession = computed(() =>
    sessionList.value.find((session) => session.id === currentSessionId.value)
  )

  // 当前页面正在展示哪个会话，就返回那个会话对应的消息数组。
  const messages = computed(() => {
    if (!currentSessionId.value) return []
    return messagesMap.value[currentSessionId.value] ?? []
  })

  /**
   * 防抖保存到本地存储
   *
   * 这里做了两层保护：
   * 1. 保存前估算体积，超限时先清理旧消息
   * 2. 保存失败时记录用户可读错误，并再次尝试清理
   *
   * 为什么要防抖？
   * 因为流式输出时消息会频繁变化，如果每个 chunk 都立刻写 localStorage，
   * 会产生明显额外开销。
   */
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

  /**
   * 清理旧消息，为 localStorage 腾空间。
   */
  function cleanupOldMessages(): void {
    messagesMap.value = pruneStoredMessages(sessionList.value, messagesMap.value)
  }

  /**
   * 创建新会话
   *
   * 除了会话基本信息外，还会同步初始化：
   * - 对应消息数组
   * - 当前任务状态
   * - 当前步骤状态
   */
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

  /**
   * 切换当前会话
   *
   * 这里只切换前端焦点，不中止后台任务。
   * 但会清理当前展示层 streamingContent，避免切到别的会话后出现串屏。
   */
  function switchSession(id: string): boolean {
    if (!sessionList.value.some((session) => session.id === id)) return false
    currentSessionId.value = id
    clearStreamingContent()
    saveToStorage()
    return true
  }

  /**
   * 清理某个会话的运行态
   *
   * 用于：
   * - 清空当前会话
   * - 删除会话
   * - 只重置任务 / 步骤 / 加载状态，而不动持久化消息
   */
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

  /**
   * 删除会话
   *
   * 删除的不只是会话标题，还包括：
   * - 该会话消息
   * - 该会话任务状态
   * - 该会话步骤状态
   * - 该会话 loading 状态
   */
  function deleteSession(id: string): void {
    const index = sessionList.value.findIndex((session) => session.id === id)
    if (index === -1) return

    sessionList.value.splice(index, 1)

    delete messagesMap.value[id]

    currentTaskMap.value = removeRuntimeSession(currentTaskMap.value, id)
    stepMap.value = removeRuntimeSession(stepMap.value, id)
    sessionLoadingMap.value = removeRuntimeSession(sessionLoadingMap.value, id)

    // 如果删的是当前会话，需要决定新的当前会话。
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

  /**
   * 更新会话标题
   */
  function updateSessionTitle(id: string, title: string): void {
    const session = sessionList.value.find((item) => item.id === id)
    if (!session || !title.trim()) return

    session.title = title.trim().slice(0, TITLE_MAX_LENGTH)
    saveToStorage()
  }

  /**
   * 向指定会话追加一条消息
   *
   * 同时会刷新该会话的更新时间，方便侧边栏按最近会话展示。
   */
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

  /**
   * 删除当前会话中的单条消息
   */
  function deleteMessage(index: number): void {
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value
    const sessionMessages = messagesMap.value[sessionId]
    if (!sessionMessages) return

    sessionMessages.splice(index, 1)
    saveToStorage()
  }

  /**
   * 清空当前会话消息
   *
   * 清空消息前会先停止生成，并同步清掉该会话的运行态。
   */
  function clearMessages(): void {
    stopGeneration()
    if (!currentSessionId.value) return

    messagesMap.value[currentSessionId.value] = []
    clearSessionRuntimeState(currentSessionId.value)
    saveToStorage()
  }

  /**
   * 设置当前展示层的流式内容
   *
   * 注意：这不是后端原始数据仓库，而是“给当前屏幕使用的展示态”。
   */
  function setStreamingContent(sessionId: string, index: number, content: string) {
    streamingContent.value = { sessionId, index, content }
  }

  /**
   * 清理流式展示态
   */
  function clearStreamingContent() {
    streamingContent.value = null
  }

  /**
   * 重置所有仅存在于前端内存中的瞬时运行态
   *
   * 典型场景：
   * - 页面刷新后，浏览器不可能续上之前的 SSE 流
   * - 开发态热更新时，Pinia 可能暂时保留旧运行态
   *
   * 所以应用重新挂载时，要把“执行中 / 当前任务 / 步骤 / 流式展示”
   * 全部回收，并顺手清理历史里尾部残留的空 assistant 占位消息。
   */
  function resetTransientState(): void {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }

    isLoading.value = false
    sessionLoadingMap.value = {}
    currentTaskMap.value = {}
    stepMap.value = {}
    streamingContent.value = null
    messagesMap.value = sanitizeRestoredMessagesMap(messagesMap.value)
    saveToStorage()
  }

  /**
   * 获取某条消息当前应该展示的内容
   *
   * 如果这条消息正处于流式输出中，就返回 streamingContent；
   * 否则返回原始 content。
   */
  function getMessageContent(sessionId: string, index: number, originalContent: string): string {
    if (streamingContent.value?.sessionId === sessionId && streamingContent.value?.index === index) {
      return streamingContent.value.content
    }
    return originalContent
  }

  /**
   * 设置某个会话的“生成中”状态
   */
  function setSessionLoading(sessionId: string, loading: boolean) {
    sessionLoadingMap.value = setRuntimeMapValue(sessionLoadingMap.value, sessionId, loading)
  }

  /**
   * 判断某个会话是否正在生成
   */
  function isSessionLoading(sessionId: string): boolean {
    return sessionLoadingMap.value[sessionId] || false
  }

  /**
   * 设置当前 Task
   */
  function setCurrentTask(sessionId: string, task: Task | null) {
    currentTaskMap.value = setRuntimeMapValue(currentTaskMap.value, sessionId, task)
  }

  /**
   * 获取某个会话当前 Task
   */
  function getCurrentTask(sessionId: string): Task | null {
    return currentTaskMap.value[sessionId] ?? null
  }

  /**
   * 直接覆盖某个会话的步骤数组
   */
  function setSteps(sessionId: string, steps: Step[]) {
    stepMap.value = setRuntimeMapValue(stepMap.value, sessionId, steps)
  }

  /**
   * 插入或更新某个会话里的单个步骤
   *
   * 由于步骤是流式一条条到来的，所以这里使用 upsert 而不是简单 push。
   */
  function upsertStep(sessionId: string, step: Step) {
    stepMap.value = upsertSessionStep(stepMap.value, sessionId, step)
  }

  /**
   * 获取某个会话的步骤列表
   */
  function getSteps(sessionId: string): Step[] {
    return stepMap.value[sessionId] ?? []
  }

  /**
   * 发送一条聊天消息
   *
   * 这是整个前端聊天主链路最核心的方法。
   * 主流程如下：
   *
   * 1. 校验当前会话和当前生成状态
   * 2. 组装用户消息内容
   * 3. 构造发给后端的历史消息数组
   * 4. 先写入用户消息，再插入空的 assistant 占位消息
   * 5. 创建 AbortController，支持中止请求
   * 6. 重置任务 / 步骤 / 流式展示态
   * 7. 发起 Task 请求
   * 8. 在 SSE 回调里持续更新 Task、Step、消息和错误
   * 9. 请求结束后统一收尾
   */
  async function sendTaskMessage(
    content: string,
    images: ImageData[] = [],
    files: UploadedFileRef[] = []
  ): Promise<void> {
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value

    // 同一会话如果已经在生成中，就不允许重复发送，避免并发写乱状态。
    if (isSessionLoading(sessionId)) return

    // 把文本、图片、文件引用合成为最终用户消息内容。
    const userContent = buildUserMessageContent(content, images, files)
    if (!userContent && images.length === 0 && files.length === 0) return

    const userMessage: ChatMessage = {
      role: 'user',
      content: userContent || '[消息]'
    }

    // 请求消息数组不直接等于当前 messagesMap，
    // 而是通过辅助函数整理出干净的历史消息 + 当前消息。
    const sessionMessages = messagesMap.value[sessionId] ?? []
    const requestMessages = buildRequestMessages(sessionMessages, userMessage)

    // 先写入用户消息，再插入一个空 assistant 占位消息。
    addMessage(sessionId, userMessage)
    // 流式 chunk 回来时，会持续追加到这条占位消息上。
    addMessage(sessionId, { role: 'assistant', content: '' })
    // 记录 assistant 这条消息的下标
    const assistantIndex = (messagesMap.value[sessionId] ?? []).length - 1
    // 如果存在旧请求，先中止。
    if (abortController.value) {
      abortController.value.abort()
    }

    // 为当前请求创建新的 AbortController。
    abortController.value = new AbortController()
    const requestSignal = abortController.value.signal

    // 进入“生成中”状态，并清理上一轮运行态。
    isLoading.value = true
    setSessionLoading(sessionId, true)
    setCurrentTask(sessionId, null)
    setSteps(sessionId, [])
    clearStreamingContent()

    try {
      // 真正发请求
      await sendTaskRequest(
        {
          messages: requestMessages,
          images: images.length > 0 ? images : undefined,
          files: files.length > 0 ? files : undefined,
          // 温度参数
          temperature: 0.7
        },
        {
          // Task 开始时记录任务对象，并清空旧步骤。
          onTaskStart: (task) => {
            setCurrentTask(sessionId, task)
            setSteps(sessionId, [])
          },

          // Task 更新时直接覆盖最新状态。
          onTaskUpdate: (task) => {
            setCurrentTask(sessionId, task)
          },

          // Step 事件统一走 upsert。
          onStepStart: (step) => {
            upsertStep(sessionId, step)
          },
          onStepComplete: (step) => {
            upsertStep(sessionId, step)
          },
          onStepError: (step) => {
            upsertStep(sessionId, step)
          },

          // 内容分片到来时，持续追加到 assistant 占位消息。
          onContent: (chunk) => {
            const sessionMessages = messagesMap.value[sessionId]
            if (!sessionMessages?.[assistantIndex]) return

            sessionMessages[assistantIndex].content += chunk

            // 只有当前页面正停留在这个会话时，才同步更新展示层流式内容。
            if (currentSessionId.value === sessionId) {
              setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          },

          // 出错时把错误信息拼接到当前 assistant 消息里，而不是直接丢掉。
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

          // 任务完成时记录最终 Task。
          // 如果这是该会话第一次提问，还会顺手生成一个更像标题的名称。
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
      // 只清理“属于本次请求”的 controller，避免误伤新请求。
      if (abortController.value?.signal === requestSignal) {
        abortController.value = null
      }

      // 请求结束后退出 loading 态。
      isLoading.value = false
      setSessionLoading(sessionId, false)

      // 如果用户还停留在当前会话，清理展示层流式内容。
      if (currentSessionId.value === sessionId) {
        clearStreamingContent()
      }

      // 最后统一落盘。
      saveToStorage()
    }
  }

  /**
   * 停止当前生成
   *
   * 本质上是：
   * - abort 当前请求
   * - 清理 controller
   * - 退出 loading
   * - 清理展示层流式状态
   */
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

  /**
   * 初始化 Store
   *
   * - 本地有会话时恢复历史数据
   * - 本地没有会话时自动创建一个新会话
   */
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

  // 对外暴露的状态和方法。
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
    resetTransientState,
    setStreamingContent,
    clearStreamingContent,
    getMessageContent,
    setSessionLoading,
    isSessionLoading,
    getCurrentTask,
    getSteps
  }
})
