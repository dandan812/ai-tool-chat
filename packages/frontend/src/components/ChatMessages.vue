<script setup lang="ts">
/**
 * 消息列表组件
 *
 * 目标：
 * - 统一欢迎页与消息列表的内容版心
 * - 优化长对话的滚动体验
 * - 保持流式输出时的自动滚动能力
 *
 * @package frontend/src/components
 */

import { computed, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'
import ChatWelcome from './ChatWelcome.vue'

const emit = defineEmits<{
  /** 发送消息 */
  send: [content: string]
}>()

const store = useChatStore()
const { container, isAtBottom, scrollToBottom, shouldAutoScroll } = useScroll()

/** 展示中的消息列表 */
const displayMessages = computed(() => {
  const sessionId = store.currentSessionId
  if (!sessionId) return []

  return store.messages.map((message, index) => {
    if (
      store.streamingContent?.sessionId === sessionId &&
      store.streamingContent?.index === index
    ) {
      return {
        ...message,
        content: store.streamingContent.content
      }
    }

    return message
  })
})

/** 是否显示回到底部按钮 */
const showScrollButton = computed(() => {
  return displayMessages.value.length > 2 && !isAtBottom.value
})

watch(() => displayMessages.value.length, () => {
  scrollToBottom()
})

watch(
  () => displayMessages.value[displayMessages.value.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

/**
 * 处理欢迎页建议点击
 * @param suggestion 建议文案
 */
function handleSuggestion(suggestion: string) {
  emit('send', suggestion)
}
</script>

<template>
  <main ref="container" class="messages">
    <div class="messages-shell">
      <ChatWelcome
        v-if="displayMessages.length === 0"
        @select="handleSuggestion"
      />

      <div v-else class="message-list">
        <ChatMessage
          v-for="(message, index) in displayMessages"
          :key="`${index}-${message.role}`"
          :index="index"
          :role="message.role"
          :content="message.content"
          @delete="store.deleteMessage"
        />
      </div>
    </div>

    <button
      v-show="showScrollButton"
      class="scroll-bottom-btn"
      type="button"
      @click="scrollToBottom()"
    >
      <span>回到底部</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="7 13 12 18 17 13"></polyline>
        <polyline points="7 6 12 11 17 6"></polyline>
      </svg>
    </button>
  </main>
</template>

<style scoped>
.messages {
  position: relative;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-4) var(--space-6) var(--space-6);
}

.messages-shell {
  width: min(100%, var(--layout-content-max));
  margin: 0 auto;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-bottom: var(--space-8);
}

.scroll-bottom-btn {
  position: sticky;
  left: 100%;
  bottom: var(--space-5);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  padding: 0.8rem 0.95rem;
  border: 1px solid rgba(201, 106, 23, 0.16);
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  color: var(--text-secondary);
  box-shadow: var(--shadow-panel);
  cursor: pointer;
  backdrop-filter: blur(16px);
  transition: all var(--transition-fast);
}

.scroll-bottom-btn:hover {
  color: var(--text-primary);
  transform: translateY(-1px);
}

@media (max-width: 768px) {
  .messages {
    padding: var(--space-3) var(--space-4) var(--space-5);
  }

  .message-list {
    gap: var(--space-5);
  }

  .scroll-bottom-btn {
    bottom: var(--space-4);
    padding: 0.7rem 0.9rem;
  }
}
</style>
