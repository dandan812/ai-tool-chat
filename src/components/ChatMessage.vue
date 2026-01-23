<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

const props = defineProps<{
  role: 'user' | 'assistant' | 'system'
  content: string
}>()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const htmlContent = computed(() => {
  return md.render(props.content)
})

const isUser = computed(() => props.role === 'user')
</script>

<template>
  <div class="message-container" :class="{ 'message-user': isUser, 'message-ai': !isUser }">
    <div class="avatar">
      {{ isUser ? '👤' : '🤖' }}
    </div>
    <div class="message-content">
      <div v-if="!isUser" class="markdown-body" v-html="htmlContent"></div>
      <div v-else>{{ content }}</div>
    </div>
  </div>
</template>

<style scoped>
.message-container {
  display: flex;
  gap: 12px;
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

.message-user {
  flex-direction: row-reverse;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #eee;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.message-content {
  background: #f4f4f4;
  padding: 12px 16px;
  border-radius: 12px;
  max-width: 80%;
  line-height: 1.6;
  word-wrap: break-word;
}

.message-user .message-content {
  background: #007bff;
  color: white;
  border-radius: 12px 0 12px 12px;
}

.message-ai .message-content {
  background: #f0f0f0;
  border-radius: 0 12px 12px 12px;
}

/* 简单的 markdown 样式补充 */
:deep(.markdown-body pre) {
  background: #2d2d2d;
  color: #ccc;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}

:deep(.markdown-body code) {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 4px;
  border-radius: 4px;
}

:deep(.markdown-body p) {
  margin: 0 0 8px 0;
}
:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}
</style>
