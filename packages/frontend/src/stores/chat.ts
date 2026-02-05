import { defineStore } from 'pinia'
import { ref, computed, shallowRef } from 'vue'
import { type ChatMessage, sendChatRequest } from '../api/ai'
import { getUserFriendlyError } from '../utils/error'

// ==================== 类型定义 ====================

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

interface StorageData {
  sessionList: ChatSession[]
  messagesMap: Record<string, ChatMessage[]>
  currentSessionId: string
}

// ==================== 常量定义 ====================

const STORAGE_KEYS = {
  SESSION_LIST: 'chat_session_list',
  MESSAGES_MAP: 'chat_messages_map',
  CURRENT_SESSION_ID: 'chat_current_session_id'
} as const

const STORAGE_VERSION = 'v1'
const MAX_STORAGE_SIZE = 4 * 1024 * 1024 // 4MB 限制
const TITLE_MAX_LENGTH = 50
const DEBOUNCE_MS = 300

// ==================== 工具函数 ====================

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function estimateSize(data: unknown): number {
  return new Blob([JSON.stringify(data)]).size
}

// ==================== Store 定义 ====================

export const useChatStore = defineStore('chat', () => {
  // State
  const sessionList = ref<ChatSession[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const currentSessionId = ref<string>('')
  const isLoading = ref(false)
  const abortController = shallowRef<AbortController | null>(null)
  const storageError = ref<string | null>(null)
  
  // 按会话的 loading 状态
  const sessionLoadingMap = ref<Record<string, boolean>>({})
  
  // 流式内容追踪 - 用于实时显示AI生成内容
  const streamingContent = ref<{ sessionId: string; index: number; content: string } | null>(null)

  // Getters
  const sessions = computed(() => sessionList.value)
  const currentSession = computed(() =>
    sessionList.value.find((s) => s.id === currentSessionId.value)
  )
  const messages = computed(() => {
    if (!currentSessionId.value) return []
    return messagesMap.value[currentSessionId.value] ?? []
  })

  // ==================== 存储管理 ====================

  const saveToStorage = debounce(() => {
    try {
      const data = {
        sessionList: sessionList.value,
        messagesMap: messagesMap.value,
        version: STORAGE_VERSION
      }

      // 检查存储大小
      if (estimateSize(data) > MAX_STORAGE_SIZE) {
        // 清理旧消息
        cleanupOldMessages()
      }

      localStorage.setItem(STORAGE_KEYS.SESSION_LIST, JSON.stringify(sessionList.value))
      localStorage.setItem(STORAGE_KEYS.MESSAGES_MAP, JSON.stringify(messagesMap.value))
      localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION_ID, currentSessionId.value)
      storageError.value = null
    } catch (error) {
      console.error('Storage save failed:', error)
      storageError.value = getUserFriendlyError(error as Error, '存储失败')
      cleanupOldMessages()
    }
  }, DEBOUNCE_MS)

  function cleanupOldMessages(): void {
    const sessions = sessionList.value
    if (sessions.length <= 3) return

    // 保留最近3个会话的完整消息
    const recentIds = new Set(sessions.slice(0, 3).map(s => s.id))
    const newMap: Record<string, ChatMessage[]> = {}

    for (const [id, msgs] of Object.entries(messagesMap.value)) {
      if (recentIds.has(id)) {
        newMap[id] = msgs
      } else {
        // 旧会话只保留最近10条
        newMap[id] = msgs.slice(-10)
      }
    }

    messagesMap.value = newMap
  }

  function loadFromStorage(): StorageData | null {
    try {
      const sessionListData = localStorage.getItem(STORAGE_KEYS.SESSION_LIST)
      const messagesMapData = localStorage.getItem(STORAGE_KEYS.MESSAGES_MAP)
      const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION_ID)

      if (!sessionListData || !messagesMapData) return null

      const sessions: ChatSession[] = JSON.parse(sessionListData)
      const messages: Record<string, ChatMessage[]> = JSON.parse(messagesMapData)

      // 数据验证
      if (!Array.isArray(sessions)) return null

      return {
        sessionList: sessions,
        messagesMap: messages,
        currentSessionId: currentId ?? sessions[0]?.id ?? ''
      }
    } catch (error) {
      console.error('Storage load failed:', error)
      return null
    }
  }

  // ==================== 会话管理 ====================

  function createSession(title?: string, initialMessages?: ChatMessage[]): string {
    const id = generateId()
    const now = Date.now()

    const newSession: ChatSession = {
      id,
      title: title?.trim() || '新对话',
      createdAt: now,
      updatedAt: now
    }

    sessionList.value.unshift(newSession)
    messagesMap.value = { ...messagesMap.value, [id]: initialMessages ?? [] }
    currentSessionId.value = id
    saveToStorage()

    return id
  }

  function switchSession(id: string): boolean {
    if (!sessionList.value.some((s) => s.id === id)) return false
    currentSessionId.value = id
    saveToStorage()
    return true
  }

  function deleteSession(id: string): void {
    const index = sessionList.value.findIndex((s) => s.id === id)
    if (index === -1) return

    sessionList.value.splice(index, 1)
    const newMap = { ...messagesMap.value }
    delete newMap[id]
    messagesMap.value = newMap

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
    const session = sessionList.value.find((s) => s.id === id)
    if (!session || !title.trim()) return

    session.title = title.trim().slice(0, TITLE_MAX_LENGTH)
    saveToStorage()
  }

  // ==================== 消息管理 ====================

  function addMessage(sessionId: string, message: ChatMessage): void {
    if (!messagesMap.value[sessionId]) {
      messagesMap.value = { ...messagesMap.value, [sessionId]: [] }
    }
    messagesMap.value[sessionId]!.push(message)

    const session = sessionList.value.find((s) => s.id === sessionId)
    if (session) {
      session.updatedAt = Date.now()
    }

    saveToStorage()
  }

  function deleteMessage(index: number): void {
    if (!currentSessionId.value) return
    const sessionId = currentSessionId.value
    const msgs = messagesMap.value[sessionId]
    if (!msgs) return

    msgs.splice(index, 1)
    messagesMap.value = { ...messagesMap.value }
    saveToStorage()
  }

  function clearMessages(): void {
    stopGeneration()
    if (!currentSessionId.value) return

    messagesMap.value = { ...messagesMap.value, [currentSessionId.value]: [] }
    saveToStorage()
  }

  // ==================== AI 交互 ====================

  async function generateSmartTitle(
    sessionId: string,
    userMsg: string,
    aiMsg: string
  ): Promise<void> {
    if (!userMsg.trim() || !aiMsg.trim()) return

    const prompt = `请根据以下对话生成一个简短的标题（10字以内），直接返回标题内容，不要包含标点符号和引号：

用户：${userMsg.slice(0, 300)}
AI：${aiMsg.slice(0, 300)}`

    let titleBuffer = ''

    try {
      await sendChatRequest(
        [{ role: 'user', content: prompt }],
        (chunk) => { titleBuffer += chunk },
        () => {}, // 忽略错误
        () => {
          const finalTitle = titleBuffer
            .trim()
            .replace(/^["']|["']$/g, '')
            .replace(/[。，.]$/, '')
          if (finalTitle) {
            updateSessionTitle(sessionId, finalTitle)
          }
        }
      )
    } catch {
      // 静默失败，标题不重要
    }
  }

  async function sendMessage(content: string, isReGenerate = false): Promise<void> {
    if (isLoading.value || (!content.trim() && !isReGenerate)) return
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value
    const sessionMessages = messagesMap.value[sessionId] ?? []

    if (!isReGenerate) {
      addMessage(sessionId, { role: 'user', content: content.trim() })
    }

    const assistantIndex = sessionMessages.push({ role: 'assistant', content: '' }) - 1

    isLoading.value = true
    abortController.value = new AbortController()

    try {
      const apiMessages = buildApiMessages(sessionMessages, isReGenerate)
      if (apiMessages.length === 0) {
        isLoading.value = false
        return
      }

      await sendChatRequest(
        apiMessages,
        (chunk) => {
          if (sessionMessages[assistantIndex]) {
            const msg = sessionMessages[assistantIndex]
            sessionMessages[assistantIndex] = { ...msg, content: msg.content + chunk }
          }
        },
        (error) => {
          console.error('Chat error:', error)
          const errorMsg = getUserFriendlyError(error as Error, '出错了，请重试')
          if (sessionMessages[assistantIndex]) {
            const msg = sessionMessages[assistantIndex]
            sessionMessages[assistantIndex] = { ...msg, content: msg.content + '\n\n' + errorMsg }
          }
        },
        () => {
          isLoading.value = false
          abortController.value = null
          saveToStorage()

          // 生成智能标题（前3条消息后）
          if (sessionMessages.length === 3) {
            const userMsgIndex = isReGenerate ? assistantIndex - 2 : assistantIndex - 1
            const userMsg = sessionMessages[userMsgIndex]?.content || content
            const aiMsg = sessionMessages[assistantIndex]?.content || ''
            if (userMsg && aiMsg) {
              generateSmartTitle(sessionId, userMsg, aiMsg)
            }
          }
        },
        abortController.value.signal
      )
    } catch {
      isLoading.value = false
      abortController.value = null
    }
  }

  function buildApiMessages(messages: ChatMessage[], isReGenerate: boolean): ChatMessage[] {
    const sliceEnd = isReGenerate ? -2 : -1
    const apiMessages = messages
      .slice(0, sliceEnd)
      .filter((m) => m.role !== 'system')
      .map((m) => ({ ...m }))

    // 移除开头的 assistant 消息
    if (apiMessages[0]?.role === 'assistant') {
      apiMessages.shift()
    }

    return apiMessages
  }

  function stopGeneration(): void {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
      isLoading.value = false
    }
  }

  // ==================== 初始化 ====================

  function init(): void {
    const data = loadFromStorage()

    if (data?.sessionList?.length) {
      sessionList.value = data.sessionList
      messagesMap.value = data.messagesMap
      currentSessionId.value = data.currentSessionId || data.sessionList[0]?.id || ''
    } else {
      createSession()
    }
  }

  // ==================== 流式内容辅助函数 ====================
  
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
  
  // ==================== 按会话 loading 状态 ====================
  
  function setSessionLoading(sessionId: string, loading: boolean) {
    sessionLoadingMap.value[sessionId] = loading
  }
  
  function isSessionLoading(sessionId: string): boolean {
    return sessionLoadingMap.value[sessionId] || false
  }

  init()

  // ==================== 导出 ====================

  return {
    // State
    sessions,
    currentSession,
    messages,
    messagesMap,
    streamingContent,
    currentSessionId,
    isLoading,
    storageError,

    // Actions
    createSession,
    switchSession,
    deleteSession,
    addMessage,
    deleteMessage,
    sendMessage,
    stopGeneration,
    clearChat: clearMessages,
    cleanupOldMessages,
    setStreamingContent,
    clearStreamingContent,
    getMessageContent,
    setSessionLoading,
    isSessionLoading
  }
})
