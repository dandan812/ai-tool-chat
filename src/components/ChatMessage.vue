<script setup lang="ts">
import { computed, ref } from 'vue'
// 引入 markdown-it 库，用于将 Markdown 文本转换为 HTML
import MarkdownIt from 'markdown-it'

// 定义组件接收的 Props
// role: 消息发送者角色 (用户/AI/系统)
// content: 消息文本内容
const props = defineProps<{
  role: 'user' | 'assistant' | 'system'
  content: string
  index: number
}>()

const emit = defineEmits<{
  (e: 'delete', index: number): void
}>()

// 初始化 Markdown 解析器配置
const md = new MarkdownIt({
  html: false,    // 禁用 HTML 标签，防止 XSS 攻击
  linkify: true,  // 自动识别并转换 URL 为链接
  breaks: true,   // 将换行符转换为 <br>
})

// 计算属性：将 Markdown 文本转换为 HTML
// 仅当 content 变化时重新计算，提高性能
const htmlContent = computed(() => {
  return md.render(props.content)
})

// 计算属性：判断当前是否为用户消息
// 用于动态控制样式和头像显示
const isUser = computed(() => props.role === 'user')
</script>

<template>
  <!-- 消息容器：根据 isUser 动态添加 message-user 或 message-ai 类名 -->
  <div class="message-container" :class="{ 'message-user': isUser, 'message-ai': !isUser }">
    <!-- 头像区域 -->
    <div class="avatar">
      {{ isUser ? '👤' : '🤖' }}
    </div>
    <!-- 消息内容区域 -->
    <div class="message-content">
      <!-- AI 消息：使用 v-html 渲染 Markdown 转换后的 HTML -->
      <div v-if="!isUser" class="markdown-body" v-html="htmlContent"></div>
      <!-- 用户消息：直接显示纯文本 -->
      <div v-else>{{ content }}</div>

      <!-- 悬浮操作按钮 -->
      <div class="message-actions">
        <button @click="emit('delete', index)" class="action-btn" title="删除消息">🗑️</button>
      </div>
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
  position: relative; /* 为操作按钮定位 */
}

/* 悬浮操作按钮样式 */
.message-actions {
  position: absolute;
  bottom: -30px;
  left: 0;
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

.message-user .message-actions {
  left: auto;
  right: 0;
}

.message-container:hover .message-actions {
  opacity: 1;
}

.action-btn {
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.action-btn:hover {
  background: #f0f0f0;
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
