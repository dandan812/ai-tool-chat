<script setup lang="ts">
import { ref } from 'vue'

// 定义 Props：接收父组件传来的数据
const props = defineProps<{
  loading?: boolean // 是否正在生成中（用于控制按钮状态和禁用输入框）
}>()

// 定义 Emits：向父组件发送的事件
const emit = defineEmits<{
  (e: 'send', content: string): void // 发送消息事件，携带消息内容
  (e: 'stop'): void                  // 停止生成事件
}>()

// 响应式变量：绑定输入框的内容
const input = ref('')

// 处理发送逻辑
function handleSend() {
  // 如果内容为空（去除首尾空格后）或正在加载中，则不发送
  if (!input.value.trim() || props.loading) return
  
  // 触发 'send' 事件，把内容传给父组件
  emit('send', input.value)
  
  // 发送后清空输入框
  input.value = ''
}

// 处理键盘按键事件
function handleKeydown(e: KeyboardEvent) {
  // 如果按下了 Enter 键，且没有按 Shift 键（Shift+Enter 用于换行）
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault() // 阻止默认的回车换行行为
    handleSend()       // 执行发送
  }
}
</script>

<template>
  <div class="input-container">
    <div class="input-wrapper">
      <!-- 文本输入区域 -->
      <textarea
        v-model="input"
        @keydown="handleKeydown"
        placeholder="输入消息，Shift + Enter 换行..."
        rows="1"
        :disabled="loading"
        class="chat-textarea"
      ></textarea>

      <!-- 发送按钮：非加载状态显示 -->
      <button 
        v-if="!loading"
        @click="handleSend" 
        class="send-btn"
        :disabled="!input.trim()"
      >
        发送
      </button>

      <!-- 停止按钮：加载状态显示 -->
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
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
}

.input-wrapper {
  max-width: 800px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--input-wrapper-bg);
  padding: 10px;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.input-wrapper:focus-within {
  border-color: #007bff;
  background: var(--input-bg);
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
  color: var(--text-color);
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
