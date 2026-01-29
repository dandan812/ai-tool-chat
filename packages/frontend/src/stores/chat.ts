import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { type ChatMessage, sendChatRequest } from '../api/ai'

// 定义会话接口结构（重构后）
export interface ChatSession {
  id: string // 会话唯一标识
  title: string // 会话标题（自动生成或默认）
  createdAt: number // 创建时间戳
  updatedAt: number // 更新时间戳
  systemPrompt?: string // 系统提示词（人设）
  unreadCount?: number // 未读消息数
}

// 定义 Chat Store，使用 Setup Store 风格 (类似 Vue Composition API)
export const useChatStore = defineStore('chat', () => {
  // ==========================================
  // 1. 状态定义 (State) - 重构后
  // ==========================================

  // 会话列表：用于 UI 展示、排序等
  const sessionList = ref<ChatSession[]>([])

  // 消息映射：按 sessionId 存储消息，支持 O(1) 查找
  const messagesMap = ref<Record<string, ChatMessage[]>>({})

  // 当前激活的会话 ID
  const currentSessionId = ref<string>('')

  // UI 状态：是否正在等待 AI 响应
  const isLoading = ref(false)

  // 用于中断请求的控制器 (AbortController)
  const abortController = ref<AbortController | null>(null)

  // ==========================================
  // 2. 初始化逻辑 (Init & Migration)
  // ==========================================
  function init() {
    // 尝试从 localStorage 读取数据
    const savedSessionList = localStorage.getItem('chat_session_list')
    const savedMessagesMap = localStorage.getItem('chat_messages_map')
    const savedCurrentId = localStorage.getItem('chat_current_session_id')

    if (savedSessionList && savedMessagesMap) {
      // 如果有新版数据，直接加载
      sessionList.value = JSON.parse(savedSessionList)
      messagesMap.value = JSON.parse(savedMessagesMap)
      // 恢复上次选中的会话，如果不存在则默认选第一个
      currentSessionId.value = savedCurrentId || sessionList.value[0]?.id || ''
    } else {
      // 检查是否有旧版本数据 (兼容性处理)
      const oldSessions = localStorage.getItem('chat_sessions')
      if (oldSessions) {
        // 迁移旧数据
        const oldData = JSON.parse(oldSessions)
        const newSessionList: ChatSession[] = []
        const newMessagesMap: Record<string, ChatMessage[]> = {}

        oldData.forEach(
          (session: {
            id: string
            title: string
            createdAt: number
            systemPrompt?: string
            messages?: ChatMessage[]
          }) => {
            newSessionList.push({
              id: session.id,
              title: session.title,
              createdAt: session.createdAt,
              updatedAt: session.createdAt,
              systemPrompt: session.systemPrompt
            })
            newMessagesMap[session.id] = session.messages || []
          }
        )

        sessionList.value = newSessionList
        messagesMap.value = newMessagesMap
        currentSessionId.value = savedCurrentId || newSessionList[0]?.id || ''
      } else {
        // 全新用户，创建一个默认的新会话
        createSession()
      }
    }
  }

  // ==========================================
  // 3. 计算属性 (Getters)
  // ==========================================

  // 获取当前选中的会话对象
  const currentSession = computed(() =>
    sessionList.value.find((s) => s.id === currentSessionId.value)
  )

  // 获取当前会话的消息列表
  const messages = computed(() => {
    if (!currentSessionId.value) return []
    return messagesMap.value[currentSessionId.value] || []
  })

  // ==========================================
  // 4. 核心动作 (Actions)
  // ==========================================

  /**
   * 创建新会话
   * @param title 可选标题
   * @param initialMessages 可选初始消息
   */
  function createSession(title?: string, initialMessages?: ChatMessage[]) {
    // 生成唯一 ID (简单实现：时间戳 + 随机数)
    const id = Date.now().toString() + Math.random().toString(36).slice(2)

    const newSession: ChatSession = {
      id,
      title: title || '新对话', // 默认标题
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    // 添加到会话列表开头
    sessionList.value.unshift(newSession)

    // 初始化消息数组
    messagesMap.value[id] = initialMessages || []

    // 自动切换到新创建的会话
    currentSessionId.value = id

    return id
  }

  // 切换当前会话
  function switchSession(id: string) {
    // 确保 ID 存在于会话列表中
    if (sessionList.value.some((s) => s.id === id)) {
      currentSessionId.value = id
      // 切换时重置未读计数
      const session = sessionList.value.find((s) => s.id === id)
      if (session) {
        session.unreadCount = 0
      }
    }
  }

  // 删除会话
  function deleteSession(id: string) {
    const index = sessionList.value.findIndex((s) => s.id === id)
    if (index === -1) return

    // 从会话列表中移除
    sessionList.value.splice(index, 1)
    // 从消息映射中删除
    delete messagesMap.value[id]

    // 如果删除的是当前正在查看的会话，需要处理选中状态的迁移
    if (id === currentSessionId.value) {
      if (sessionList.value.length > 0) {
        // 尝试切换到原来位置的会话
        const newIndex = Math.min(index, sessionList.value.length - 1)
        const target = sessionList.value[newIndex]
        if (target) {
          currentSessionId.value = target.id
        }
      } else {
        // 如果删光了所有会话，自动创建一个新的
        createSession()
      }
    }
  }

  // 更新特定会话的标题
  function updateSessionTitle(id: string, title: string) {
    const session = sessionList.value.find((s) => s.id === id)
    if (session) {
      session.title = title
    }
  }

  // 更新系统提示词
  function updateSystemPrompt(id: string, prompt: string) {
    const session = sessionList.value.find((s) => s.id === id)
    if (session) {
      session.systemPrompt = prompt
    }
  }

  // 删除单条消息
  function deleteMessage(index: number) {
    if (!currentSessionId.value) return

    const messages = messagesMap.value[currentSessionId.value]
    if (messages) {
      messages.splice(index, 1)
    }
  }

  /**
   * 智能生成标题
   * 在后台调用 AI 根据对话内容生成简短标题
   */
  async function generateSmartTitle(sessionId: string, userMsg: string, aiMsg: string) {
    if (!userMsg.trim() || !aiMsg.trim()) return

    // 构造 Prompt：截取前 300 字符以节省 Token，要求生成 10 字以内的标题
    const prompt = `请根据以下对话生成一个简短的标题（10字以内），直接返回标题内容，不要包含标点符号和引号：\n\n用户：${userMsg.slice(0, 300)}\nAI：${aiMsg.slice(0, 300)}`

    let titleBuffer = ''
    try {
      // 发送独立的请求生成标题
      await sendChatRequest(
        [{ role: 'user', content: prompt }],
        (chunk) => {
          titleBuffer += chunk
        },
        (error) => {
          console.warn('Auto title generation failed:', error)
        },
        () => {
          // 处理生成的标题：去除首尾空格、引号和句号
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
      console.warn('Auto title generation exception:', e)
    }
  }

  /**
   * 发送消息的核心逻辑
   */
  async function sendMessage(content: string, isReGenerate = false) {
    // 校验：如果正在加载且不是重新生成，或者内容为空且不是重新生成，则忽略
    if (isLoading.value || (!content.trim() && !isReGenerate)) return
    // 校验：如果没有选中会话，则忽略
    if (!currentSessionId.value) return

    const sessionId = currentSessionId.value
    const messages = messagesMap.value[sessionId] || []

    if (!isReGenerate) {
      // 1. 将用户消息添加到 UI
      messages.push({ role: 'user', content })

      // 更新会话的更新时间
      const session = sessionList.value.find((s) => s.id === sessionId)
      if (session) {
        session.updatedAt = Date.now()
      }
    }

    // 2. 预先添加一条空的 AI 消息占位，用于流式显示
    const assistantMessageIndex = messages.push({ role: 'assistant', content: '' }) - 1

    isLoading.value = true
    abortController.value = new AbortController()

    try {
      // 准备发送的消息列表
      const sliceEnd = isReGenerate ? -2 : -1
      const apiMessages = messages
        .slice(0, sliceEnd)
        .filter((m) => m.role !== 'system')
        .map((m) => ({ ...m })) // 简单的深度克隆

      // 如果第一条消息是助手消息（通常是欢迎语），则移除它
      if (apiMessages?.length > 0 && apiMessages[0]?.role === 'assistant') {
        apiMessages.shift()
      }

      // 如果有系统提示词，插入到最前面
      const session = sessionList.value.find((s) => s.id === sessionId)
      if (session?.systemPrompt?.trim()) {
        // 1. 在最前面插入系统消息
        apiMessages.unshift({
          role: 'system',
          content: `You must strictly follow this persona: ${session.systemPrompt}`
        })

        // 2. 在最后一条用户消息中再次强化指令
        const lastMsg = apiMessages[apiMessages.length - 1]
        if (lastMsg && lastMsg.role === 'user') {
          lastMsg.content = `[IMPORTANT: Remember to speak as ${session.systemPrompt}]\n\n${lastMsg.content}`
        }
      }

      // 调试：在控制台打印发送给 AI 的完整消息列表
      console.log('Sending to AI:', apiMessages)

      // 如果过滤后没有任何消息，则直接返回
      if (apiMessages.length === 0) {
        isLoading.value = false
        return
      }

      // 发送请求
      await sendChatRequest(
        apiMessages,
        // onChunk: 收到流式数据片段
        (chunk) => {
          if (messages[assistantMessageIndex]) {
            messages[assistantMessageIndex].content += chunk
          }
        },
        // onError: 发生错误
        (error) => {
          console.error('Chat error:', error)
          if (messages[assistantMessageIndex]) {
            messages[assistantMessageIndex].content += '\n\n[出错了，请重试]'
          }
        },
        // onFinish: 完成
        () => {
          isLoading.value = false
          abortController.value = null

          // 3. 触发智能标题生成逻辑
          if (messages.length === 3) {
            const userMsgIndex = isReGenerate
              ? assistantMessageIndex - 2
              : assistantMessageIndex - 1
            const userMsg = messages[userMsgIndex]?.content || content
            const aiMsg = messages[assistantMessageIndex]?.content || ''
            if (userMsg && aiMsg) {
              generateSmartTitle(sessionId, userMsg, aiMsg)
            }
          }
        },
        abortController.value?.signal
      )
    } catch (err) {
      console.error(err)
      isLoading.value = false
    }
  }

  // 停止生成
  function stopGeneration() {
    if (abortController.value) {
      abortController.value.abort() // 发送中断信号
      abortController.value = null
      isLoading.value = false
    }
  }

  // 清空当前会话的消息（保留会话本身）
  function clearChat() {
    stopGeneration()
    if (!currentSessionId.value) return

    // 重置为空数组
    messagesMap.value[currentSessionId.value] = []
  }

  // ==========================================
  // 5. 持久化监听 (Persistence)
  // ==========================================

  // 监听 sessionList 变化，自动保存到 localStorage
  watch(
    sessionList,
    (newVal) => {
      localStorage.setItem('chat_session_list', JSON.stringify(newVal))
    },
    { deep: true }
  )

  // 监听 messagesMap 变化，自动保存到 localStorage
  watch(
    messagesMap,
    (newVal) => {
      localStorage.setItem('chat_messages_map', JSON.stringify(newVal))
    },
    { deep: true }
  )

  // 监听 currentSessionId 变化，记住用户上次选中的会话
  watch(currentSessionId, (newVal) => {
    localStorage.setItem('chat_current_session_id', newVal)
  })

  // 执行初始化
  init()

  // 导出 Store API
  return {
    // 重构后的数据结构
    sessionList,
    messagesMap,

    // 兼容原有 API
    sessions: computed(() => sessionList.value),
    currentSessionId,
    currentSession,
    messages,
    isLoading,

    // 核心方法
    createSession,
    switchSession,
    deleteSession,
    updateSystemPrompt,
    deleteMessage,
    sendMessage,
    stopGeneration,
    clearChat
  }
})
