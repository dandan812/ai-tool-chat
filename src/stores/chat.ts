import { defineStore } from 'pinia'
import { ref } from 'vue'
// type 关键字 ：明确告诉编译器， ChatMessage 只是一个 类型定义 （比如接口 Interface），
// 而不是一个具体的实现类或实例。
import { type ChatMessage, sendChatRequest } from '../api/ai'

// 定义聊天存储模块
// 用于管理聊天对话历史、加载状态、取消请求等
// 命名规范（ use + Store名称 + Store ）
// defineStore 函数：用于创建一个 Pinia 存储模块
// 第一个参数：存储模块的唯一标识符（ID），用于在应用中引用该模块
// 第二个参数：一个函数，返回一个对象，包含该模块的状态、操作（actions）和获取器（getters）
export const useChatStore = defineStore('chat', () => {
  // 定义响应式状态 messages，用于存储对话历史
  const messages = ref<ChatMessage[]>([
    { role: 'assistant', content: '你好！我是你的 AI 助手，有什么可以帮你的吗？' }
  ])    
  // isLoading 状态用于控制加载动画和防止重复提交
  const isLoading = ref(false)
  // abortController 用于中止正在进行的请求
  const abortController = ref<AbortController | null>(null)

  // 发送消息的核心方法
  // 负责处理用户输入、更新状态、调用 API 层发送请求、处理流式响应等逻辑
  async function sendMessage(content: string) {
    // 1. 检查是否正在加载，防止重复点击
    if (isLoading.value) return
    // 2. 检查内容是否为空或仅包含空格
    if (!content.trim()) return

    // 1. 添加用户发送的消息到列表中
    messages.value.push({ role: 'user', content })
    
    // 2. 预先添加一条空的助手消息占位，后续流式更新其内容
    // push(...) ：把空消息塞进去，并告诉我“现在一共有多少条消息了”
    const assistantMessageIndex = messages.value.push({ role: 'assistant', content: '' }) - 1
    
    // 3. 设置加载状态并创建 AbortController 实例
    isLoading.value = true
    // 3. 创建 AbortController 实例，用于取消请求
    abortController.value = new AbortController()

    try {
      // 4. 调用 API 层发送请求
      await sendChatRequest(
        // slice(0, -1) 的意思就是“从头取到倒数第二个”。
        messages.value.slice(0, -1), // 发送除了刚才添加的空消息之外的所有消息作为上下文
        (chunk) => {
          // 收到数据块时的回调：追加到最后一条助手消息中
          if (messages.value[assistantMessageIndex]) {
            messages.value[assistantMessageIndex].content += chunk
          }
        },
        (error) => {
          // 错误处理回调
          console.error('Chat error:', error)
          if (messages.value[assistantMessageIndex]) {
            messages.value[assistantMessageIndex].content += '\n\n[出错了，请重试]'
          }
        },
        () => {
          // 完成时的回调：重置状态
          isLoading.value = false
          abortController.value = null
        },
        abortController.value.signal // 传入 signal 以支持取消
      )
    } catch (err) {
      console.error(err)
      isLoading.value = false
    }
  }

  // 停止生成的方法
  function stopGeneration() {
    if (abortController.value) {
      abortController.value.abort() // 中止 fetch 请求
      abortController.value = null
      isLoading.value = false
    }
  }

  // 清空对话历史
  // 负责清空聊天历史记录、重置加载状态、取消任何正在进行的请求
  function clearChat() {
    stopGeneration() // 清空前先停止正在进行的生成
    // 重置为默认欢迎语，而不是完全清空
    messages.value = [
      { role: 'assistant', content: '你好！我是你的 AI 助手，有什么可以帮你的吗？' }
    ]
  }

  return {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    clearChat
  }
})
