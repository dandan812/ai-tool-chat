<script setup lang="ts">
/**
 * 聊天主页面
 */
import { ref, computed, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { sendTaskRequest } from '../api/task'
import type { ImageData, FileData } from '../types/task'
import { getUserFriendlyError } from '../utils/error'

// 组件导入
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import Toast from '../components/Toast.vue'
import './Chat.css'

// ==================== 状态管理 ====================

const store = useChatStore()
const isSidebarOpen = ref(false)
/** 用于取消当前请求的 AbortController */
let abortController: AbortController | null = null

// ==================== 监听器 ====================

// 会话切换时只重置当前显示状态，不取消后台请求
watch(
  () => store.currentSessionId,
  (newSessionId, oldSessionId) => {
    // 清理当前显示的流式内容
    store.clearStreamingContent()
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

  // 取消之前的请求
  if (abortController) {
    abortController.abort()
  }

  // 创建新的 AbortController
  abortController = new AbortController()

  // 构建用户消息内容
  let userContent = content
  if (images.length > 0 && !userContent) {
    userContent = '[图片]'
  } else if (files.length > 0 && !userContent) {
    userContent = `[文件: ${files.map(f => f.name).join(', ')}]`
  }

  // 获取当前消息列表（在添加新消息之前）
  const currentMessages = store.messagesMap[sessionId] || []

  // 添加用户消息
  store.addMessage(sessionId, {
    role: 'user',
    content: userContent || '[消息]'
  })

  // 准备 AI 回复位置
  const messages = store.messagesMap[sessionId] || []
  const assistantIndex = messages.length
  store.addMessage(sessionId, { role: 'assistant', content: '' })

  // 设置加载状态
  store.setSessionLoading(sessionId, true)

  try {
    // 构建 API 消息 - 使用添加前的消息，并过滤掉空内容
    const apiMessages = currentMessages
      .filter(m => m.content.trim().length > 0)
      .map((m) => ({
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
        // 内容回调 - 逐字显示
        onContent: (chunk: string) => {
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            sessionMessages[assistantIndex].content += chunk
            // 只在当前会话显示流式内容
            if (store.currentSessionId === sessionId) {
              store.setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          }
        },

        // 错误回调
        onError: (error: string) => {
          console.error('Task error:', error)
          const userError = getUserFriendlyError(new Error(error), '出错了，请重试')
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            sessionMessages[assistantIndex].content += `\n\n${userError}`
            if (store.currentSessionId === sessionId) {
              store.setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          }
        },

        // 完成回调
        onComplete: () => {
          // 清理流式内容
          if (store.currentSessionId === sessionId) {
            store.clearStreamingContent()
          }
        }
      },
      abortController.signal
    )
  } catch (error) {
    // 如果是用户取消，不显示错误
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      console.error('Send message failed:', error)
      const userError = getUserFriendlyError(error as Error, '发送失败，请重试')
      const sessionMessages = store.messagesMap[sessionId]
      if (sessionMessages && sessionMessages[assistantIndex] && !sessionMessages[assistantIndex].content) {
        sessionMessages[assistantIndex].content = userError
        store.setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
      }
    }
  } finally {
    store.setSessionLoading(sessionId, false)
    abortController = null
    // 只在当前会话清理流式内容
    if (store.currentSessionId === sessionId) {
      store.clearStreamingContent()
    }
  }
}

/**
 * 停止当前请求
 */
function handleStop() {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
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
      <ChatMessages @send="handleSend" />
      <footer class="chat-footer">
        <ChatInput
          :loading="store.isSessionLoading(store.currentSessionId)"
          @send="handleSend"
          @stop="handleStop"
        />
      </footer>
    </div>

    <!-- 存储错误提示 -->
    <Toast
      :show="!!store.storageError"
      message="存储空间不足，已清理部分旧数据"
      type="warning"
      @close="store.storageError = null"
    />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.chat-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-footer {
  flex-shrink: 0;
  padding: var(--space-4) var(--space-8);
  background: var(--bg-color);
}

/* 响应式 */
@media (max-width: 768px) {
  .chat-footer {
    padding: var(--space-3) var(--space-4);
  }
}
</style>
