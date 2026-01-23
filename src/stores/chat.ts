import { defineStore } from 'pinia'
import { ref } from 'vue'
import { type ChatMessage, sendChatRequest } from '../api/ai'

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([
    { role: 'assistant', content: '你好！我是你的 AI 助手，有什么可以帮你的吗？' }
  ])
  const isLoading = ref(false)
  const abortController = ref<AbortController | null>(null)

  async function sendMessage(content: string) {
    if (isLoading.value) return
    if (!content.trim()) return

    // 添加用户消息
    messages.value.push({ role: 'user', content })
    
    // 准备 AI 回复占位
    const assistantMessageIndex = messages.value.push({ role: 'assistant', content: '' }) - 1
    
    isLoading.value = true
    abortController.value = new AbortController()

    try {
      await sendChatRequest(
        messages.value.slice(0, -1), // 发送除了刚才添加的空消息之外的所有消息
        (chunk) => {
          if (messages.value[assistantMessageIndex]) {
            messages.value[assistantMessageIndex].content += chunk
          }
        },
        (error) => {
          console.error('Chat error:', error)
          if (messages.value[assistantMessageIndex]) {
            messages.value[assistantMessageIndex].content += '\n\n[出错了，请重试]'
          }
        },
        () => {
          isLoading.value = false
          abortController.value = null
        },
        abortController.value.signal
      )
    } catch (err) {
      console.error(err)
      isLoading.value = false
    }
  }

  function stopGeneration() {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
      isLoading.value = false
    }
  }

  function clearChat() {
    stopGeneration()
    messages.value = []
  }

  return {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    clearChat
  }
})
