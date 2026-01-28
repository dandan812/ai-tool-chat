<script setup lang="ts">
import { computed } from 'vue'
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
  html: false, // 禁用 HTML 标签，防止 XSS 攻击
  linkify: true, // 自动识别并转换 URL 为链接
  breaks: true // 将换行符转换为 <br>
})

// 自定义代码块渲染逻辑，添加复制按钮
const defaultRender =
  md.renderer.rules.fence ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (!token) return ''

  const code = token.content.replace(/"/g, '&quot;')
  const info = token.info ? token.info.trim() : ''
  const lang = info.split(/\s+/g)[0]

  const rawCode = defaultRender(tokens, idx, options, env, self)
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${lang || 'code'}</span>
        <button class="copy-code-btn" data-code="${code}">Copy</button>
      </div>
      ${rawCode}
    </div>
  `
}

// 计算属性：将 Markdown 文本转换为 HTML
// 仅当 content 变化时重新计算，提高性能
const htmlContent = computed(() => {
  return md.render(props.content)
})

// 处理点击事件，委托处理复制按钮
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('copy-code-btn')) {
    const code = target.getAttribute('data-code')
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        const originalText = target.innerText
        target.innerText = 'Copied!'
        target.classList.add('copied')
        setTimeout(() => {
          target.innerText = originalText
          target.classList.remove('copied')
        }, 2000)
      })
    }
  }
}

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
      <div
        v-if="!isUser"
        class="markdown-body"
        v-html="htmlContent"
        @click="handleContentClick"
      ></div>
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
  background: var(--btn-secondary-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.message-content {
  background: var(--message-ai-bg);
  color: var(--text-color);
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
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  color: var(--text-color);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  background: var(--btn-secondary-hover);
}

.message-user .message-content {
  background: var(--message-user-bg);
  color: var(--message-user-text);
  border-radius: 12px 0 12px 12px;
}

.message-ai .message-content {
  background: var(--message-ai-bg);
  color: var(--text-color);
  border-radius: 0 12px 12px 12px;
}

/* 简单的 markdown 样式补充 */
:deep(.markdown-body pre) {
  background: #1e1e1e; /* 代码块背景保持深色 */
  color: #d4d4d4;
  padding: 12px;
  border-radius: 0 0 6px 6px; /* 顶部圆角留给 header */
  overflow-x: auto;
  margin: 0;
  font-family: Consolas, Menlo, Monaco, 'Courier New', monospace;
  white-space: pre;
  line-height: 1.5;
}

:deep(.code-block-wrapper) {
  margin: 12px 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

:deep(.code-block-header) {
  background: #2d2d2d;
  color: #aaa;
  padding: 4px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-family: sans-serif;
}

:deep(.copy-code-btn) {
  background: transparent;
  border: 1px solid #555;
  color: #aaa;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 64px;
}

:deep(.copy-code-btn:hover) {
  background: #444;
  color: #fff;
  border-color: #777;
}

:deep(.copy-code-btn.copied) {
  color: #4cd964;
  border-color: #4cd964;
}

:deep(.markdown-body code) {
  background: var(--btn-secondary-bg);
  color: var(--text-color);
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
