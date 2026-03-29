<script setup lang="ts">
/**
 * 聊天主页面
 */
import { ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { ImageData, FileData } from '../types/task'

// 组件导入
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import StepIndicator from '../components/StepIndicator.vue'
import Toast from '../components/Toast.vue'
import './Chat.css'

// ==================== 状态管理 ====================

const store = useChatStore()
const isSidebarOpen = ref(false)

// ==================== 监听器 ====================

// 会话切换时只重置当前显示状态，不取消后台请求
watch(
  () => store.currentSessionId,
  () => {
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
  await store.sendTaskMessage(content, images, files)
}

/**
 * 停止当前请求
 */
function handleStop() {
  store.stopGeneration()
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
        <StepIndicator
          :task="store.getCurrentTask(store.currentSessionId)"
          :steps="store.getSteps(store.currentSessionId)"
        />
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
