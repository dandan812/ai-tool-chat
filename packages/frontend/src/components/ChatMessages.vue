<script setup lang="ts">
/**
 * 消息列表组件
 * 渲染消息、处理自动滚动、空状态和加载状态
 */
import { watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'

// ==================== Store & Composables ====================

const store = useChatStore()
const { container, scrollToBottom, shouldAutoScroll } = useScroll()

// ==================== 自动滚动 ====================

// 消息数量变化时滚动到底部
watch(() => store.messages.length, scrollToBottom)

// 最后一条消息内容变化时（流式输出）智能滚动
watch(
  () => store.messages[store.messages.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

// ==================== 快捷提问 ====================

const SUGGESTIONS = [
  '给我一个简单的 JavaScript 代码示例',
  '解释一下什么是 Vue 3',
  '帮我写一个前端简历模板'
] as const
</script>

<template>
  <main ref="container" class="chat-messages">
    <!-- 空状态 -->
    <div v-if="store.messages.length === 0" class="empty-state">
      <h2>你好！我是你的 AI 助手</h2>
      <p>有什么我可以帮助你的吗？</p>

      <div class="suggestions">
        <button
          v-for="suggestion in SUGGESTIONS"
          :key="suggestion"
          class="suggestion-btn"
          @click="store.sendMessage(suggestion)"
        >
          {{ suggestion }}
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <ChatMessage
      v-for="(msg, index) in store.messages"
      :key="`${index}-${msg.role}`"
      :index="index"
      :role="msg.role"
      :content="msg.content"
      @delete="store.deleteMessage"
    />

    <!-- 加载状态 -->
    <div v-if="store.isLoading" class="loading-state">
      <div class="loading-spinner" />
      <p>AI 正在思考...</p>
    </div>
  </main>
</template>
