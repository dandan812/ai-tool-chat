import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { type ChatMessage, sendChatRequest } from '../api/ai'

/**
 * ==================== 类型定义 ====================
 */

/** 会话信息 */
export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  systemPrompt?: string
}

/** 存储数据结构 */
interface StorageData {
  sessionList: ChatSession[]
  messagesMap: Record<string, ChatMessage[]>
  currentSessionId: string
}

/**
 * ==================== 常量定义 ====================
 */

const STORAGE_KEYS = {
  SESSION_LIST: 'chat_session_list',
  MESSAGES_MAP: 'chat_messages_map',
  CURRENT_SESSION_ID: 'chat_current_session_id'
} as const

/**
 * ==================== Store 定义 ====================
 */

export const useChatStore = defineStore('chat', () => {
  // ==================== State ====================

  const sessionList = ref<ChatSession[]>([])
  const messagesMap = ref<Record<string, ChatMessage[]>>({})
  const currentSessionId = ref<string>('')
  const isLoading = ref(false)
  const abortController = ref<AbortController | null>(null)

  // ==================== Getters ====================

  const currentSession = computed(() =>
    sessionList.value.find((s) => s.id === currentSessionId.value)
  )

  const messages = computed(() => {
    if (!currentSessionId.value) return []
    return messagesMap.value[currentSessionId.value] ?? []
  })

  // ==================== 本地存储操作 ====================

  function saveToStorage() {
    localStorage.setItem(STORAGE_KEYS.SESSION_LIST, JSON.stringify(sessionList.value))
    localStorage.setItem(STORAGE_KEYS.MESSAGES_MAP, JSON.stringify(messagesMap.value))
    localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION_ID, currentSessionId.value)
  }

  function loadFromStorage(): StorageData | null {
    try {
      const sessionList = localStorage.getItem(STORAGE_KEYS.SESSION_LIST)
      const messagesMap = localStorage.getItem(STORAGE_KEYS.MESSAGES_MAP)
      const currentSessionId = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION_ID)

      if (sessionList && messagesMap) {
        return {
          sessionList: JSON.parse(sessionList),
          messagesMap: JSON.parse(messagesMap),
          currentSessionId: currentSessionId ?? ''
        }
      }
    } catch (error) {
      console.error('Failed to load from storage:', error)
    }
    return null
  }

  // ==================== 会话管理 ====================

  function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  }

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
    messagesMap.value[id] = initialMessages ?? []
    currentSessionId.value = id
    saveToStorage()

    return id
  }

  function switchSession(id: string): void {
    if (sessionList.value.some((s) => s.id === id)) {
      currentSessionId.value = id
      saveToStorage()
    }
  }

  function deleteSession(id: string): void {
    const index = sessionList.value.findIndex((s) => s.id === id)
    if (index === -1) return

    sessionList.value.splice(index, 1)
    delete messagesMap.value[id]

    if (id === currentSessionId.value) {
      if (sessionList.value.length > 0) {
        const newIndex = Math.min(index, sessionList.value.length - 1)
        const targetSession = sessionList.value[newIndex]
        if (targetSession) {
          currentSessionId.value = targetSession.id
        }
      } else {
        createSession()
      }
    }

    saveToStorage()
  }

  function updateSessionTitle(id: string, title: string): void {
    const session = sessionList.value.find((s) => s.id === id)
    if (session && title.trim()) {
      session.title = title.trim().slice(0, 50)
      saveToStorage()
    }
  }

  function updateSystemPrompt(id: string, prompt: string): void {
    const session = sessionList.value.find((s) => s.id === id)
    if (session) {
      session.systemPrompt = prompt
      saveToStorage()
    }
  }

  // ==================== 消息管理 ====================

  function addMessage(sessionId: string, message: ChatMessage): void {
    if (!messagesMap.value[sessionId]) {
      messagesMap.value[sessionId] = []
    }
    messagesMap.value[sessionId].push(message)

    const session = sessionList.value.find((s) => s.id === sessionId)
    if (session) {
      session.updatedAt = Date.now()
    }

    saveToStorage()
  }

  function deleteMessage(index: number): void {
    if (!currentSessionId.value) return
    messagesMap.value[currentSessionId.value]?.splice(index, 1)
    saveToStorage()
  }

  function clearMessages(): void {
    stopGeneration()
    if (currentSessionId.value) {
      messagesMap.value[currentSessionId.value] = []
      saveToStorage()
    }
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
        (chunk) => {
          titleBuffer += chunk
        },
        (error) => {
          console.warn('Title generation failed:', error)
        },
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
    } catch (e) {
      console.warn('Title generation exception:', e)
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
            sessionMessages[assistantIndex].content += chunk
          }
        },
        (error) => {
          console.error('Chat error:', error)
          const errorMsg =
            error.message.includes('Failed to fetch') || error.message.includes('network error')
              ? '[后端服务未部署，请检查 Cloudflare Worker 配置]'
              : '[出错了，请重试]'
          if (sessionMessages[assistantIndex]) {
            sessionMessages[assistantIndex].content += '\n\n' + errorMsg
          }
        },
        () => {
          isLoading.value = false
          abortController.value = null
          saveToStorage()

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
    } catch (err) {
      console.error(err)
      isLoading.value = false
    }
  }

  function buildApiMessages(messages: ChatMessage[], isReGenerate: boolean): ChatMessage[] {
    const sliceEnd = isReGenerate ? -2 : -1
    const apiMessages = messages
      .slice(0, sliceEnd)
      .filter((m) => m.role !== 'system')
      .map((m) => ({ ...m }))

    const firstMessage = apiMessages[0]
    if (firstMessage && firstMessage.role === 'assistant') {
      apiMessages.shift()
    }

    const session = currentSession.value
    if (session?.systemPrompt?.trim()) {
      apiMessages.unshift({
        role: 'system',
        content: `You must strictly follow this persona: ${session.systemPrompt}`
      })

      const lastMsg = apiMessages[apiMessages.length - 1]
      if (lastMsg?.role === 'user') {
        lastMsg.content = `[IMPORTANT: Remember to speak as ${session.systemPrompt}]\n\n${lastMsg.content}`
      }
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

    if (data) {
      sessionList.value = data.sessionList
      messagesMap.value = data.messagesMap
      currentSessionId.value = data.currentSessionId || sessionList.value[0]?.id || ''
    } else {
      createSession()
    }
  }

  init()

  // ==================== 导出 ====================

  return {
    // State
    sessionList,
    messagesMap,
    currentSessionId,
    isLoading,

    // Getters (兼容旧 API)
    sessions: computed(() => sessionList.value),
    currentSession,
    messages,

    // Actions
    createSession,
    switchSession,
    deleteSession,
    updateSystemPrompt,
    deleteMessage,
    sendMessage,
    stopGeneration,
    clearChat: clearMessages
  }
})
