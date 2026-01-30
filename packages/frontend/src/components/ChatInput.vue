<script setup lang="ts">
/**
 * 聊天输入组件
 * 支持多行输入、Enter 发送、Shift+Enter 换行
 */
import { ref, useTemplateRef } from 'vue'

// ==================== Props & Emits ====================

interface Props {
  loading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  send: [content: string]
  stop: []
}>()

// ==================== 输入处理 ====================

const input = ref('')
const textareaRef = useTemplateRef<HTMLTextAreaElement>('textarea')

function handleSend() {
  const content = input.value.trim()
  if (!content || props.loading) return

  emit('send', content)
  input.value = ''

  // 重置输入框高度
  const el = textareaRef.value
  if (el) {
    el.style.height = 'auto'
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// 自动调整高度
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}
</script>

<template>
  <div class="input-container">
    <div class="input-wrapper">
      <textarea
        ref="textarea"
        v-model="input"
        :disabled="loading"
        placeholder="输入消息..."
        rows="1"
        class="chat-textarea"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <!-- 发送按钮 -->
      <button v-if="!loading" class="send-btn" :disabled="!input.trim()" @click="handleSend">
        发送
      </button>

      <!-- 停止按钮 -->
      <button v-else class="stop-btn" @click="emit('stop')">停止</button>
    </div>
  </div>
</template>

<style scoped>
.input-container {
  padding: 20px;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 1000px;
  margin: 0 auto;
  padding: 12px;
  background: var(--input-wrapper-bg);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.input-wrapper:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.1);
}

.chat-textarea {
  flex: 1;
  min-height: 36px;
  max-height: 200px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-color);
  background: transparent;
  border: none;
  resize: none;
  outline: none;
}

.send-btn,
.stop-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.send-btn {
  background: var(--btn-primary-bg);
}

.send-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

.send-btn:disabled {
  background: var(--btn-secondary-bg);
  cursor: not-allowed;
}

.stop-btn {
  background: var(--error-color);
}

.stop-btn:hover {
  background: var(--error-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
}
</style>
