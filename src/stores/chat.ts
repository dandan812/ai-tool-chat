import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { type ChatMessage, sendChatRequest } from '../api/ai'

// 定义会话接口结构
export interface ChatSession {
  id: string          // 会话唯一标识
  title: string       // 会话标题（自动生成或默认）
  messages: ChatMessage[] // 会话包含的消息列表
  createdAt: number   // 创建时间戳
  systemPrompt?: string // 系统提示词（人设）
}

// 定义 Chat Store，使用 Setup Store 风格 (类似 Vue Composition API)
export const useChatStore = defineStore('chat', () => {
  
  // ==========================================
  // 1. 状态定义 (State)
  // ==========================================
  
  // 存储所有会话的列表
  const sessions = ref<ChatSession[]>([])
  
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
    // 尝试从 localStorage 读取多会话数据
    const savedSessions = localStorage.getItem('chat_sessions')
    const savedCurrentId = localStorage.getItem('chat_current_session_id')

    if (savedSessions) {
      // 如果有新版数据，直接加载
      sessions.value = JSON.parse(savedSessions)
      // 恢复上次选中的会话，如果不存在则默认选第一个
      currentSessionId.value = savedCurrentId || sessions.value[0]?.id || ''
    } else {
      // 如果没有多会话数据，检查是否有旧版本的单会话数据 (兼容性处理)
      const oldHistory = localStorage.getItem('chat_history')
      if (oldHistory) {
        // 迁移旧数据：将旧的单会话历史转换为一个新的会话
        const oldMessages = JSON.parse(oldHistory)
        createSession('历史对话', oldMessages)
        // 注意：这里保留旧数据不删除，防止意外丢失
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
    sessions.value.find(s => s.id === currentSessionId.value)
  )

  // 获取当前会话的消息列表
  // (主要为了兼容原有 Chat.vue 代码，使其不需要大幅修改即可直接使用 messages)
  const messages = computed(() => currentSession.value?.messages || [])

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
      messages: initialMessages || [
        // 默认的第一条系统/欢迎消息
        { role: 'assistant', content: '你好！我是你的 AI 助手，有什么可以帮你的吗？' }
      ],
      createdAt: Date.now()
    }
    
    // 将新会话添加到列表开头
    sessions.value.unshift(newSession)
    // 自动切换到新创建的会话
    currentSessionId.value = id
  }

  // 切换当前会话
  function switchSession(id: string) {
    // 确保 ID 存在于列表中才切换
    if (sessions.value.find(s => s.id === id)) {
      currentSessionId.value = id
    }
  }

  // 删除会话
  function deleteSession(id: string) {
    const index = sessions.value.findIndex(s => s.id === id)
    if (index === -1) return

    // 从列表中移除
    sessions.value.splice(index, 1)

    // 如果删除的是当前正在查看的会话，需要处理选中状态的迁移
    if (id === currentSessionId.value) {
      if (sessions.value.length > 0) {
        // 尝试切换到原来位置的会话（即删除项的后一项），如果是最后一项则切换到前一项
        const newIndex = Math.min(index, sessions.value.length - 1)
        const target = sessions.value[newIndex]
        if (target) {
          currentSessionId.value = target.id
        }
      } else {
        // 如果删光了所有会话，自动创建一个新的，保证 UI 不会空白
        createSession() 
      }
    }
  }

  // 更新特定会话的标题
  function updateSessionTitle(id: string, title: string) {
    const session = sessions.value.find(s => s.id === id)
    if (session) {
      session.title = title
    }
  }

  // 更新系统提示词
  function updateSystemPrompt(id: string, prompt: string) {
    const session = sessions.value.find(s => s.id === id)
    if (session) {
      session.systemPrompt = prompt
    }
  }

  // 删除单条消息
  function deleteMessage(index: number) {
    if (currentSession.value) {
      currentSession.value.messages.splice(index, 1)
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
      // 注意：这里不需要 abortSignal，因为这是后台任务，不应被用户停止生成的动作中断
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
          const finalTitle = titleBuffer.trim().replace(/^["']|["']$/g, '').replace(/[。，.]$/, '')
          if (finalTitle) {
            updateSessionTitle(sessionId, finalTitle)
          }
        }
      )
    } catch (e) {
      // 标题生成失败不影响主流程，仅打印警告
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
    if (!currentSession.value) return

    const session = currentSession.value

    if (!isReGenerate) {
      // 1. 将用户消息添加到 UI
      session.messages.push({ role: 'user', content })
    }
    
    // 2. 预先添加一条空的 AI 消息占位，用于流式显示
    const assistantMessageIndex = session.messages.push({ role: 'assistant', content: '' }) - 1
    
    isLoading.value = true
    abortController.value = new AbortController()

    try {
      // 准备发送的消息列表
      // 1. 获取上下文消息
      // 如果是重新生成，需要排除掉最后一条（即正在被重新生成的）AI 消息
      // 注意：此时最后一条是占位符，倒数第二条是旧的 AI 消息
      const sliceEnd = isReGenerate ? -2 : -1
      let apiMessages = session.messages
        .slice(0, sliceEnd)
        .filter(m => m.role !== 'system')
        .map(m => ({ ...m })) // 简单的深度克隆
      
      // 如果第一条消息是助手消息（通常是欢迎语），则移除它
      if (apiMessages?.length > 0 && apiMessages[0]?.role === 'assistant') {
        apiMessages.shift()
      }
      
      // 如果有系统提示词，插入到最前面
      if (session.systemPrompt?.trim()) {
        // 1. 在最前面插入系统消息
        apiMessages.unshift({ 
          role: 'system', 
          content: `You must strictly follow this persona: ${session.systemPrompt}` 
        })
        
        // 2. 在最后一条用户消息中再次强化指令（这是对抗长对话惯性的最强手段）
        const lastMsg = apiMessages[apiMessages.length - 1]
        if (lastMsg && lastMsg.role === 'user') {
          lastMsg.content = `[IMPORTANT: Remember to speak as ${session.systemPrompt}]\n\n${lastMsg.content}`
        }
      }

      // 调试：在控制台打印发送给 AI 的完整消息列表
      console.log('Sending to AI:', apiMessages)

      // 如果过滤后没有任何消息（这不应该发生，因为刚 push 了一个 user 消息），则直接返回
      if (apiMessages.length === 0) {
        isLoading.value = false
        return
      }

      // 发送请求
      await sendChatRequest(
        apiMessages,
        // onChunk: 收到流式数据片段
        (chunk) => {
          if (session.messages[assistantMessageIndex]) {
            session.messages[assistantMessageIndex].content += chunk
          }
        },
        // onError: 发生错误
        (error) => {
          console.error('Chat error:', error)
          if (session.messages[assistantMessageIndex]) {
            session.messages[assistantMessageIndex].content += '\n\n[出错了，请重试]'
          }
        },
        // onFinish: 完成
        () => {
          isLoading.value = false
          abortController.value = null

          // 3. 触发智能标题生成逻辑
          // 仅当这是会话的第一轮完整对话后触发（通常是第 3 条消息：1.欢迎语 2.用户 3.AI）
          if (session.messages.length === 3) { 
            // 如果是重新生成，用户消息在当前占位符的前两项 (Index - 2)
            // 如果是新发送，用户消息就在当前占位符的前一项 (Index - 1)
            const userMsgIndex = isReGenerate ? assistantMessageIndex - 2 : assistantMessageIndex - 1
            const userMsg = session.messages[userMsgIndex]?.content || content
            const aiMsg = session.messages[assistantMessageIndex]?.content || ''
            // 异步执行，不阻塞 UI
            if (userMsg && aiMsg) {
              generateSmartTitle(session.id, userMsg, aiMsg)
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
    if (currentSession.value) {
        // 重置为仅剩初始欢迎语
        currentSession.value.messages = [
            { role: 'assistant', content: '你好！我是你的 AI 助手，有什么可以帮你的吗？' }
        ]
    }
  }

  // ==========================================
  // 5. 持久化监听 (Persistence)
  // ==========================================
  
  // 监听 sessions 变化，自动保存到 localStorage
  watch(
    sessions,
    (newVal) => {
      localStorage.setItem('chat_sessions', JSON.stringify(newVal))
    },
    { deep: true } // 深度监听，因为是数组且内部对象会变
  )

  // 监听 currentSessionId 变化，记住用户上次选中的会话
  watch(
    currentSessionId,
    (newVal) => {
      localStorage.setItem('chat_current_session_id', newVal)
    }
  )

  // 执行初始化
  init()

  // 导出 Store API
  return {
    sessions,
    currentSessionId,
    currentSession, // 供组件获取当前会话详情
    messages,       // 供组件获取当前消息列表
    isLoading,
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
