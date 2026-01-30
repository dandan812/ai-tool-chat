<script setup lang="ts">
/**
 * 单条消息组件
 * 支持 Markdown 渲染、代码块复制、消息删除
 */
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

// ==================== Props & Emits ====================

interface Props {
  role: 'user' | 'assistant' | 'system'
  content: string
  index: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  delete: [index: number]
}>()

// ==================== Markdown 配置 ====================

const md = new MarkdownIt({
  html: false, // 禁用 HTML，防止 XSS
  linkify: true, // 自动转换 URL 为链接
  breaks: true // 换行转 <br>
})

// 自定义代码块渲染，添加复制按钮
const defaultRender =
  md.renderer.rules.fence ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (!token) return ''

  const code = token.content.replace(/"/g, '&quot;')
  const lang = token.info?.trim().split(/\s+/)[0] ?? ''
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

// ==================== 计算属性 ====================

const htmlContent = computed(() => md.render(props.content))
const isUser = computed(() => props.role === 'user')

// ==================== 事件处理 ====================

function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.classList.contains('copy-code-btn')) return

  const code = target.getAttribute('data-code')
  if (!code) return

  navigator.clipboard.writeText(code).then(() => {
    const original = target.textContent ?? 'Copy'
    target.textContent = 'Copied!'
    target.classList.add('copied')

    setTimeout(() => {
      target.textContent = original
      target.classList.remove('copied')
    }, 2000)
  })
}
</script>

<template>
  <div class="message-container" :class="{ 'message-user': isUser, 'message-ai': !isUser }">
    <div class="message-content">
      <!-- AI 消息：Markdown 渲染 -->
      <div v-if="!isUser" class="markdown-body" v-html="htmlContent" @click="handleClick" />

      <!-- 用户消息：纯文本 -->
      <div v-else>{{ content }}</div>

      <!-- 操作按钮 -->
      <div class="message-actions">
        <button class="action-btn" title="删除消息" @click="emit('delete', index)">🗑️</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-container {
  display: flex;
  gap: 12px;
  max-width: 800px;
  margin: 0 auto;
  padding: 16px;
}

.message-user {
  flex-direction: row-reverse;
}

.message-content {
  position: relative;
  max-width: 80%;
  padding: 12px 16px;
  line-height: 1.6;
  word-wrap: break-word;
  border-radius: 12px;
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

/* 操作按钮 */
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
  padding: 2px 6px;
  font-size: 14px;
  color: var(--text-color);
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  background: var(--btn-secondary-hover);
}

/* Markdown 样式 - 浅色模式 */
:deep(.markdown-body) {
  will-change: transform;
  backface-visibility: hidden;
}

:deep(.markdown-body pre) {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  font-family: Consolas, Menlo, Monaco, 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre;
  background: #f3f4f6;
  border-radius: 0 0 8px 8px;
}

:deep(.code-block-wrapper) {
  margin: 16px 0;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

:deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  font-family: sans-serif;
  font-size: 12px;
  color: #6b7280;
  background: #e5e7eb;
  border-bottom: 1px solid #e5e7eb;
}

:deep(.code-lang) {
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

:deep(.copy-code-btn) {
  min-width: 70px;
  padding: 4px 12px;
  font-size: 11px;
  color: #e5e7eb;
  cursor: pointer;
  background: #374151;
  border: 1px solid #4b5563;
  border-radius: 4px;
  transition: all 0.2s;
}

:deep(.copy-code-btn:hover) {
  color: #ffffff;
  background: #4b5563;
  border-color: #6b7280;
}

:deep(.copy-code-btn.copied) {
  color: #ffffff;
  background: #10b981;
  border-color: #10b981;
}

:deep(.markdown-body code) {
  padding: 2px 4px;
  color: var(--text-color);
  background: var(--btn-secondary-bg);
  border-radius: 4px;
}

:deep(.markdown-body p) {
  margin: 0 0 8px;
}

:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

/* 深色模式 - 代码块样式 (组件级别) */
:deep(.code-block-wrapper) {
  /* 确保深色模式下边框正确 */
}

:deep(.code-block-header) {
  /* 确保深色模式下头部正确 */
}
</style>
