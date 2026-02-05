<script setup lang="ts">
/**
 * 聊天主页面
 */
import { ref, computed, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { sendTaskRequest } from '../api/task'
import type { ImageData, FileData } from '../types/task'

// 组件导入
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import './Chat.css'

// ==================== 状态管理 ====================

const store = useChatStore()
const isSidebarOpen = ref(false)

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
        temperature: 0.7,
        systemPrompt: store.currentSession?.systemPrompt
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
        // 内容回调 - 逐字显示
        onContent: (chunk: string) => {
          console.log('[Chat] onContent received:', chunk)
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            sessionMessages[assistantIndex].content += chunk
            console.log('[Chat] Updated content length:', sessionMessages[assistantIndex].content.length)
            // 只在当前会话显示流式内容
            if (store.currentSessionId === sessionId) {
              store.setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
            }
          } else {
            console.log('[Chat] onContent: sessionMessages or assistantIndex is invalid')
          }
        },

        // 错误回调
        onError: (error: string) => {
          console.error('Task error:', error)
          const sessionMessages = store.messagesMap[sessionId]
          if (sessionMessages && sessionMessages[assistantIndex]) {
            sessionMessages[assistantIndex].content += `\n\n[错误: ${error}]`
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
      }
    )
  } catch (error) {
    console.error('Send message failed:', error)
    const sessionMessages = store.messagesMap[sessionId]
    if (sessionMessages && sessionMessages[assistantIndex] && !sessionMessages[assistantIndex].content) {
      sessionMessages[assistantIndex].content = '[发送失败，请重试]'
      store.setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
    }
  } finally {
    store.setSessionLoading(sessionId, false)
    // 只在当前会话清理流式内容
    if (store.currentSessionId === sessionId) {
      store.clearStreamingContent()
    }
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
        />
      </footer>
    </div>
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
