<script setup lang="ts">
/**
 * 消息列表组件
 *
 * 功能特性：
 * - 显示消息列表或欢迎页
 * - 支持流式内容实时更新
 * - 自动滚动到最新消息
 *
 * @package frontend/src/components
 */

import { watch, computed } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'
import ChatWelcome from './ChatWelcome.vue'

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 发送消息事件 */
  send: [content: string]
}>()

/** 聊天状态管理 */
const store = useChatStore()
/** 滚动管理 composable */
const { container, scrollToBottom, shouldAutoScroll } = useScroll()

/**
 * 计算属性：带流式内容的消息列表
 * 如果当前有正在流式输出的消息，则显示流式内容
 */
const displayMessages = computed(() => {
  const sessionId = store.currentSessionId
  if (!sessionId) return []

  const messages = store.messages
  return messages.map((msg, index) => {
    // 如果有流式内容且匹配当前消息，使用流式内容
    if (store.streamingContent?.sessionId === sessionId &&
        store.streamingContent?.index === index) {
      return { ...msg, content: store.streamingContent.content }
    }
    return msg
  })
})

/**
 * 监听消息数量变化，自动滚动到底部
 */
watch(() => displayMessages.value.length, () => scrollToBottom())

/**
 * 监听最后一条消息内容变化，自动滚动到底部（仅在用户处于底部时）
 */
watch(
  () => displayMessages.value[displayMessages.value.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

/**
 * 处理建议点击事件
 * 将建议内容作为消息发送
 * @param suggestion 建议文本
 */
function handleSuggestion(suggestion: string) {
  emit('send', suggestion)
}
</script>

<template>
  <main ref="container" class="messages">
    <!-- 欢迎界面 -->
    <ChatWelcome
      v-if="displayMessages.length === 0"
      @select="handleSuggestion"
    />

    <!-- 消息列表 -->
    <div v-else class="message-list">
      <ChatMessage
        v-for="(msg, index) in displayMessages"
        :key="`${index}-${msg.role}`"
        :index="index"
        :role="msg.role"
        :content="msg.content"
        @delete="store.deleteMessage"
      />
    </div>
  </main>
</template>

<style scoped>
.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6) var(--space-8);
}

.message-list {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* 响应式 */
@media (max-width: 768px) {
  .messages {
    padding: var(--space-4);
  }
}
</style>
