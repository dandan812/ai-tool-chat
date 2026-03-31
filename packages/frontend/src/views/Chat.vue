<script setup lang="ts">
/**
 * 聊天主页面
 */
import { ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { ImageData, UploadedFileRef } from '../types/task'

// 组件导入
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import StepIndicator from '../components/StepIndicator.vue'
import Toast from '../components/Toast.vue'

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
async function handleSend(content: string, images: ImageData[] = [], files: UploadedFileRef[] = []) {
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
      <div class="chat-stage">
        <ChatHeader @toggle-sidebar="toggleSidebar" />
        <div class="chat-stream">
          <ChatMessages @send="handleSend" />
        </div>
        <footer class="chat-footer">
          <div class="composer-shell">
            <StepIndicator
              :task="store.getCurrentTask(store.currentSessionId)"
              :steps="store.getSteps(store.currentSessionId)"
            />
            <ChatInput
              :loading="store.isSessionLoading(store.currentSessionId)"
              @send="handleSend"
              @stop="handleStop"
            />
          </div>
        </footer>
      </div>
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
  background:
    radial-gradient(circle at top left, rgba(201, 106, 23, 0.08), transparent 28%),
    linear-gradient(180deg, var(--surface-canvas) 0%, var(--bg-primary) 100%);
}

.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(24, 20, 17, 0.36);
  backdrop-filter: blur(8px);
  z-index: 50;
}

.chat-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.chat-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  isolation: isolate;
}

.chat-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at top right, rgba(201, 106, 23, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 22%);
  opacity: 0.8;
  z-index: -1;
}

[data-theme='dark'] .chat-stage::before {
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 18%);
}

.chat-stream {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  overflow: hidden;
  scroll-padding-bottom: 220px;
}

.chat-footer {
  flex-shrink: 0;
  position: sticky;
  bottom: 0;
  z-index: 20;
  padding: 0 var(--space-6) var(--space-5);
  background:
    linear-gradient(180deg, rgba(252, 251, 248, 0) 0%, rgba(252, 251, 248, 0.78) 24%, rgba(252, 251, 248, 0.96) 100%);
  backdrop-filter: blur(14px);
}

[data-theme='dark'] .chat-footer {
  background:
    linear-gradient(180deg, rgba(10, 10, 10, 0) 0%, rgba(10, 10, 10, 0.72) 24%, rgba(10, 10, 10, 0.94) 100%);
}

.composer-shell {
  width: min(100%, var(--layout-content-max));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: max(0px, env(safe-area-inset-bottom));
}

/* 响应式 */
@media (max-width: 768px) {
  .chat-stream {
    scroll-padding-bottom: 180px;
  }

  .chat-footer {
    padding: 0 var(--space-4) var(--space-4);
  }

  .composer-shell {
    gap: var(--space-2);
  }
}
</style>
