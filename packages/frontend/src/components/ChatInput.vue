<script setup lang="ts">
/**
 * 聊天输入组件
 * 功能：消息输入框、发送按钮、停止生成按钮、Enter 快捷键发送
 */
import { ref } from 'vue'

// ==================== Props & Emits ====================

/** 组件 Props 定义 */
const props = defineProps<{
  /** 是否正在生成回复中（控制按钮状态和禁用输入框） */
  loading?: boolean
}>()

/** 组件事件定义 */
const emit = defineEmits<{
  /** 发送消息事件，携带消息内容 */
  (e: 'send', content: string): void
  /** 停止生成事件 */
  (e: 'stop'): void
}>()

// ==================== 输入状态 ====================

/** 输入框内容绑定值 */
const input = ref('')

/**
 * 处理发送消息逻辑
 * 1. 校验：内容为空或正在加载时不发送
 * 2. 触发 send 事件传递内容
 * 3. 清空输入框
 */
function handleSend() {
  // 内容为空（去除首尾空格后）或正在加载中，则不发送
  if (!input.value.trim() || props.loading) return

  // 触发 'send' 事件，把内容传给父组件
  emit('send', input.value)

  // 发送后清空输入框
  input.value = ''
}

/**
 * 处理键盘按键事件
 * Enter: 发送消息
 * Shift + Enter: 换行
 */
function handleKeydown(e: KeyboardEvent) {
  // 按下 Enter 且未按 Shift 键时发送消息
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault() // 阻止默认的回车换行行为
    handleSend()
  }
}
</script>

<template>
  <div class="input-container">
    <div class="input-wrapper">
      <!-- 多行文本输入框 -->
      <textarea
        v-model="input"
        @keydown="handleKeydown"
        placeholder="输入消息..."
        rows="1"
        :disabled="loading"
        class="chat-textarea"
      ></textarea>

      <!-- 发送按钮：非加载状态显示，输入为空时禁用 -->
      <button v-if="!loading" @click="handleSend" class="send-btn" :disabled="!input.trim()">
        发送
      </button>

      <!-- 停止按钮：加载状态显示，用于中断 AI 生成 -->
      <button v-else @click="$emit('stop')" class="stop-btn">停止</button>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 容器样式 ==================== */

.input-container {
  padding: 20px;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
}

/* 输入框包装器：包含 textarea 和按钮 */
.input-wrapper {
  width: 100%;
  max-width: 1000px;
  margin: 0 auto;
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  background: var(--input-wrapper-bg);
  padding: 12px;
  border-radius: 20px;
  border: 1px solid var(--border-color);
  transition: all 0.2s;
}

/* 聚焦时的高亮效果 */
.input-wrapper:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.1);
}

/* ==================== 文本输入框样式 ==================== */

.chat-textarea {
  flex: 1;
  border: none;
  background: transparent;
  resize: none; /* 禁止手动调整大小 */
  padding: 10px 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  outline: none;
  max-height: 200px;
  min-height: 36px;
  color: var(--text-color);
}

/* ==================== 按钮通用样式 ==================== */

.send-btn,
.stop-btn {
  border: none;
  padding: 10px 20px;
  border-radius: 16px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  font-size: 14px;
}

/* ==================== 发送按钮样式 ==================== */

.send-btn {
  background: var(--btn-primary-bg);
  color: white;
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

/* ==================== 停止按钮样式 ==================== */

.stop-btn {
  background: var(--error-color);
  color: white;
}

.stop-btn:hover {
  background: var(--error-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
}
</style>
