<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', content: string): void
  (e: 'stop'): void
}>()

const input = ref('')

function handleSend() {
  if (!input.value.trim() || props.loading) return
  emit('send', input.value)
  input.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="input-container">
    <div class="input-wrapper">
      <textarea
        v-model="input"
        @keydown="handleKeydown"
        placeholder="输入消息，Shift + Enter 换行..."
        rows="1"
        :disabled="loading"
        class="chat-textarea"
      ></textarea>
      <button 
        v-if="!loading"
        @click="handleSend" 
        class="send-btn"
        :disabled="!input.trim()"
      >
        发送
      </button>
      <button 
        v-else 
        @click="$emit('stop')"
        class="stop-btn"
      >
        停止
      </button>
    </div>
  </div>
</template>

<style scoped>
.input-container {
  padding: 20px;
  background: white;
  border-top: 1px solid #eaeaea;
}

.input-wrapper {
  max-width: 800px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: #f4f4f4;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: border-color 0.2s;
}

.input-wrapper:focus-within {
  border-color: #007bff;
  background: white;
  box-shadow: 0 2px 10px rgba(0,0,0,0.05);
}

.chat-textarea {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  padding: 8px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  outline: none;
  max-height: 200px;
  min-height: 24px;
}

.send-btn, .stop-btn {
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.send-btn {
  background: #007bff;
  color: white;
}

.send-btn:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.stop-btn {
  background: #dc3545;
  color: white;
}

.stop-btn:hover {
  background: #c82333;
}
</style>
