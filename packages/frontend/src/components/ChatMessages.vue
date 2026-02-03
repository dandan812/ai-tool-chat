<script setup lang="ts">
/**
 * 消息列表组件 - 《反主流》美学
 * 
 * 简洁的消息列表容器
 */
import { watch, computed } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'
import ChatWelcome from './ChatWelcome.vue'
import type { Task, Step } from '../types/task'

interface Props {
  currentTask: Task | null
  currentSteps: Step[]
  isMessagePaused?: (index: number) => boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  send: [content: string]
}>()

const store = useChatStore()
const { container, scrollToBottom, shouldAutoScroll } = useScroll()

// 带流式内容的消息列表
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

// 自动滚动
watch(() => displayMessages.value.length, () => scrollToBottom())

watch(
  () => displayMessages.value[displayMessages.value.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

function handleSuggestion(suggestion: string) {
  emit('send', suggestion)
}
</script>

<template>
  <main ref="container" class="messages">
    <!-- 欢迎界面 -->
    <ChatWelcome 
      v-if="displayMessages.length === 0 && !currentTask" 
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
        :is-paused="props.isMessagePaused?.(index) ?? false"
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
