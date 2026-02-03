<script setup lang="ts">
/**
 * 聊天主页面 - 优化版
 * 使用 Composable 管理状态和逻辑
 */
import { ref, watch, computed } from 'vue'
import { useChatStore } from '../stores/chat'
import { sendTaskRequest } from '../api/task'
import { useTaskManager, createTaskCallbacks } from '../composables/useTaskManager'
import type { ImageData, FileData } from '../types/task'

// 组件导入
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import StepIndicator from '../components/StepIndicator.vue'
import './Chat.css'

// ==================== 状态管理 ====================

const store = useChatStore()
const isSidebarOpen = ref(false)

// 使用 Composable 管理 Task/Step
const taskManager = useTaskManager()

// 每个会话独立的 AbortController
const abortControllers = ref<Record<string, AbortController>>({})

// 记录被暂停的消息索引（每个会话一个 Set）
const pausedMessageIndices = ref<Record<string, Set<number>>>({})

// 当前会话是否正在加载
const isCurrentSessionLoading = computed(() => {
  const sessionId = store.currentSessionId
  return sessionId ? store.isSessionLoading(sessionId) : false
})

// ==================== 监听器 ====================

// 会话切换时只重置当前显示状态，不取消后台请求
watch(
  () => store.currentSessionId,
  (newSessionId, oldSessionId) => {
    // 保存旧会话的流式内容到消息中
    if (oldSessionId && store.streamingContent?.sessionId === oldSessionId) {
      const { index, content } = store.streamingContent
      const sessionMessages = store.messagesMap[oldSessionId]
      if (sessionMessages && sessionMessages[index]) {
        sessionMessages[index] = {
          ...sessionMessages[index],
          content
        }
      }
    }
    // 清理当前显示的流式内容
    store.clearStreamingContent()
    taskManager.reset()
    
    // 恢复新会话的流式显示状态（如果有正在进行的请求）
    if (newSessionId && abortControllers.value[newSessionId]) {
      const sessionMessages = store.messagesMap[newSessionId]
      if (sessionMessages && sessionMessages.length > 0) {
        const lastIndex = sessionMessages.length - 1
        if (sessionMessages[lastIndex]?.role === 'assistant') {
          store.setStreamingContent(newSessionId, lastIndex, sessionMessages[lastIndex].content)
        }
      }
    }
  }
)

// ==================== 方法 ====================

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value
}

function closeSidebar() {
  isSidebarOpen.value = false
}

/**
 * 发送消息（支持多模态和文件）
 */
async function handleSend(content: string, images: ImageData[] = [], files: FileData[] = []) {
  const sessionId = store.currentSessionId
  if (!sessionId || store.isSessionLoading(sessionId)) return

  // 构建用户消息内容
  let userContent = content
  if (images.length > 0 && !userContent) {
    userContent = '[图片]'
  } else if (files.length > 0 && !userContent) {
    userContent = `[文件: ${files.map(f => f.name).join(', ')}]`
  }

  // 添加用户消息
  store.addMessage(sessionId, {
    role: 'user',
    content: userContent || '[消息]'
  })

  // 准备 AI 回复位置 - 直接操作 store 中的消息数组
  const messages = store.messagesMap[sessionId] || []
  const assistantIndex = messages.length
  store.addMessage(sessionId, { role: 'assistant', content: '' })

  // 设置加载状态
  store.setSessionLoading(sessionId, true)
  taskManager.reset()
  // 为这个会话创建独立的 AbortController
  abortControllers.value[sessionId] = new AbortController()

  try {
    // 构建 API 消息
    const apiMessages = messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content
    }))

    // 发送请求
    await sendTaskRequest(
      {
        messages: apiMessages,
        images: images.length > 0 ? images : undefined,
        files: files.length > 0 ? files : undefined,
        temperature: 0.7
      },
      {
        // Task 回调
        ...createTaskCallbacks(taskManager),
        
        // 内容回调 - 逐字显示
        onContent: (chunk: string) => {
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            const currentContent = sessionMessages[assistantIndex].content
            const newContent = currentContent + chunk
            // 更新消息数组
            sessionMessages[assistantIndex] = {
              ...sessionMessages[assistantIndex],
              content: newContent
            }
            // 只在当前会话显示流式内容
            if (store.currentSessionId === sessionId) {
              store.setStreamingContent(sessionId, assistantIndex, newContent)
            }
          }
        },
        
        // 错误回调
        onError: (error: string) => {
          console.error('Task error:', error)
          // 用户主动取消时不显示错误信息
          if (error?.includes('已取消') || error?.includes('Abort') || error?.includes('aborted')) {
            return
          }
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            const currentMsg = sessionMessages[assistantIndex]
            const newContent = currentMsg.content + `\n\n[错误: ${error}]`
            sessionMessages[assistantIndex] = { ...currentMsg, content: newContent }
            if (store.currentSessionId === sessionId) {
              store.setStreamingContent(sessionId, assistantIndex, newContent)
            }
          }
        }
      },
      abortControllers.value[sessionId].signal
    )
  } catch (error) {
    console.error('Send message failed:', error)
    const sessionMessages = store.messagesMap[sessionId]
    if (sessionMessages && sessionMessages[assistantIndex] && !sessionMessages[assistantIndex].content) {
      const currentMsg = sessionMessages[assistantIndex]
      const newContent = '[发送失败，请重试]'
      sessionMessages[assistantIndex] = { ...currentMsg, content: newContent }
      store.setStreamingContent(sessionId, assistantIndex, newContent)
    }
  } finally {
    store.setSessionLoading(sessionId, false)
    delete abortControllers.value[sessionId]
    // 只在当前会话清理流式内容
    if (store.currentSessionId === sessionId) {
      store.clearStreamingContent()
    }
  }
}

/**
 * 暂停生成
 */
function handleStop() {
  const sessionId = store.currentSessionId
  if (sessionId && abortControllers.value[sessionId]) {
    // 记录当前正在生成的消息为暂停状态
    const messages = store.messagesMap[sessionId]
    if (messages) {
      const lastIndex = messages.length - 1
      if (messages[lastIndex]?.role === 'assistant') {
        if (!pausedMessageIndices.value[sessionId]) {
          pausedMessageIndices.value[sessionId] = new Set()
        }
        pausedMessageIndices.value[sessionId].add(lastIndex)
      }
    }
    
    abortControllers.value[sessionId].abort()
    delete abortControllers.value[sessionId]
    store.setSessionLoading(sessionId, false)
    taskManager.isProcessing.value = false
  }
}

/**
 * 检查消息是否被暂停
 */
function isMessagePaused(sessionId: string, index: number): boolean {
  return pausedMessageIndices.value[sessionId]?.has(index) ?? false
}
</script>

<template>
  <div class="app-layout">
    <!-- 移动端侧边栏遮罩 -->
    <div 
      v-if="isSidebarOpen" 
      class="sidebar-overlay" 
      @click="closeSidebar" 
    />

    <!-- 侧边栏 -->
    <Sidebar :is-open="isSidebarOpen" />

    <!-- 主聊天区域 -->
    <div class="chat-layout">
      <ChatHeader @toggle-sidebar="toggleSidebar" />

      <ChatMessages 
        :current-task="taskManager.currentTask.value" 
        :current-steps="taskManager.currentSteps.value"
        :is-message-paused="(index: number) => isMessagePaused(store.currentSessionId, index)"
        @send="handleSend" 
      />

      <footer class="chat-footer">
        <!-- Step 进度指示器 -->
        <StepIndicator
          v-if="taskManager.currentTask.value && taskManager.currentSteps.value.length > 0"
          :task="taskManager.currentTask.value"
          :steps="taskManager.currentSteps.value"
        />

        <ChatInput 
          :loading="isCurrentSessionLoading" 
          @send="handleSend" 
          @stop="handleStop" 
        />
      </footer>
    </div>
  </div>
</template>
