<script setup lang="ts">
/**
 * 单条消息组件 - 《反主流》美学
 *
 * 设计理念：有机气泡、温暖交互
 *
 * 功能特性：
 * - 显示用户/AI 消息气泡
 * - Markdown 内容渲染
 * - 代码块语法高亮和复制功能
 * - 消息删除操作
 * - 暂停状态显示
 *
 * @package frontend/src/components
 */

import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

/**
 * 组件属性
 */
interface Props {
  /** 消息角色（用户/AI/系统） */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容（Markdown 格式） */
  content: string
  /** 消息索引 */
  index: number
  /** 是否处于暂停状态 */
  isPaused?: boolean
}

const props = defineProps<Props>()

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 删除消息事件 */
  delete: [index: number]
}>()

/**
 * 配置 MarkdownIt，为代码块添加复制按钮
 */
const md = new MarkdownIt({
  highlight: (str: string, lang: string) => {
    const escapedStr = escapeHtml(str)
    const langDisplay = lang || 'text'

    return `
<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang">${langDisplay}</span>
    <button class="copy-code-btn" data-code="${escapeAttr(str)}" title="复制代码">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="btn-text">复制</span>
    </button>
  </div>
  <pre><code class="language-${lang || 'text'}">${escapedStr}</code></pre>
</div>
    `.trim()
  }
})

/**
 * 覆盖默认的代码块渲染规则
 * 处理代码块并添加复制功能
 */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''

  const code = token.content
  const lang = token.info?.trim() || ''

  const highlight = md.options.highlight
  if (highlight) {
    return highlight(code, lang, '')
  }
  return `<pre><code>${escapeHtml(code)}</code></pre>`
}

/**
 * HTML 转义函数
 * 防止 XSS 攻击
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * HTML 属性转义函数
 * 转义用于 HTML 属性的文本
 */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

/**
 * 计算属性：渲染后的 HTML 内容
 */
const htmlContent = computed(() => md.render(props.content))

/**
 * 计算属性：是否为用户消息
 */
const isUser = computed(() => props.role === 'user')

/**
 * 处理点击事件
 * 处理代码块复制按钮的点击
 */
function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const btn = target.closest('.copy-code-btn') as HTMLElement
  if (!btn) return

  const code = btn.getAttribute('data-code')
  if (!code) return

  navigator.clipboard.writeText(code).then(() => {
    const btnText = btn.querySelector('.btn-text')
    const originalText = btnText?.textContent ?? '复制'

    if (btnText) {
      btnText.textContent = '已复制!'
    }
    btn.classList.add('copied')

    setTimeout(() => {
      if (btnText) {
        btnText.textContent = originalText
      }
      btn.classList.remove('copied')
    }, 2000)
  })
}
</script>

<template>
  <div class="message-row" :class="{ 'user': isUser, 'ai': !isUser }">
    <!-- 头像 -->
    <div class="avatar">
      <svg v-if="isUser" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
      <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <line x1="12" y1="19" x2="12" y2="22"></line>
      </svg>
    </div>

    <!-- 内容 -->
    <div class="bubble">
      <!-- AI 消息 -->
      <div v-if="!isUser" class="markdown-body" v-html="htmlContent" @click="handleClick" />
      
      <!-- 用户消息 -->
      <div v-else class="user-text markdown-body" v-html="htmlContent" />

      <!-- 暂停标记 -->
      <div v-if="isPaused" class="pause-indicator">
        <span class="pause-dot"></span>
        <span class="pause-text">已暂停</span>
      </div>

      <!-- 操作按钮 -->
      <div class="actions">
        <button class="action-btn" title="删除" @click="emit('delete', index)">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-row {
  display: flex;
  gap: var(--space-3);
  animation: slideIn 0.4s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-row.user {
  flex-direction: row-reverse;
}

/* 头像 */
.avatar {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  flex-shrink: 0;
}

.message-row.user .avatar {
  background: var(--message-user-bg);
  color: var(--message-user-text);
}

.message-row.ai .avatar {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
}

/* 气泡 */
.bubble {
  position: relative;
  max-width: 80%;
  min-width: 0;
  padding: 16px 20px;
  line-height: 1.7;
  border-radius: var(--radius-xl);
  transition: all var(--transition-fast);
  display: flex;
  flex-direction: column;
  overflow-wrap: break-word;
}

.message-row.user .bubble {
  background: var(--message-user-bg);
  color: var(--message-user-text);
  border-bottom-right-radius: var(--radius-sm);
}

.message-row.ai .bubble {
  background: var(--message-ai-bg);
  color: var(--message-ai-text);
  border: 1px solid var(--message-ai-border);
  border-bottom-left-radius: var(--radius-sm);
}

/* Markdown 内容容器 */
.markdown-body {
  overflow-wrap: break-word;
  min-width: 0;
  width: 100%;
}

/* 用户文本 */
.user-text {
  font-size: var(--text-base);
  line-height: 1.7;
  word-break: break-word;
}

/* 用户消息的 Markdown 样式调整 */
.message-row.user :deep(.markdown-body p) {
  margin: 0 0 var(--space-3);
}

.message-row.user :deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

.message-row.user :deep(.markdown-body pre) {
  margin: var(--space-3) 0;
  padding: var(--space-3);
  overflow-x: auto;
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
  background: rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-md);
}

.message-row.user :deep(.markdown-body code) {
  padding: var(--space-1) var(--space-2);
  font-family: 'Fira Code', monospace;
  font-size: 0.9em;
  background: rgba(255, 255, 255, 0.2);
  border-radius: var(--radius-sm);
}

.message-row.user :deep(.markdown-body pre code) {
  padding: 0;
  background: transparent;
  border-radius: 0;
}

/* 操作按钮 */
.actions {
  position: absolute;
  bottom: -28px;
  left: 0;
  display: flex;
  gap: var(--space-2);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.message-row.user .actions {
  left: auto;
  right: 0;
}

.bubble:hover .actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--error);
  color: white;
  border-color: var(--error);
}

/* Markdown 样式 */
:deep(.markdown-body) {
  font-size: var(--text-base);
  line-height: 1.7;
  overflow-wrap: break-word;
}

:deep(.markdown-body p) {
  margin: 0 0 var(--space-3);
}

:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

:deep(.markdown-body pre) {
  margin: 0;
  padding: var(--space-4);
  overflow-x: auto;
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: var(--text-sm);
  line-height: 1.6;
  background: var(--gray-950);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  color: var(--gray-200);
}

:deep(.code-block-wrapper) {
  margin: var(--space-4) 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

:deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-subtle);
}

:deep(.copy-code-btn) {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

:deep(.copy-code-btn:hover) {
  color: white;
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  transform: translateY(-1px);
}

:deep(.copy-code-btn.copied) {
  color: white;
  background: var(--success);
  border-color: var(--success);
}

:deep(.code-lang) {
  font-family: var(--font-sans);
  letter-spacing: 0.05em;
}

:deep(.markdown-body code) {
  padding: var(--space-1) var(--space-2);
  font-family: 'Fira Code', monospace;
  font-size: 0.9em;
  color: var(--accent-primary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

:deep(.markdown-body pre code) {
  padding: 0;
  color: inherit;
  background: transparent;
  border-radius: 0;
}

/* 列表样式 */
:deep(.markdown-body ul),
:deep(.markdown-body ol) {
  margin: var(--space-3) 0;
  padding-left: var(--space-6);
}

:deep(.markdown-body li) {
  margin-bottom: var(--space-2);
}

/* 链接 */
:deep(.markdown-body a) {
  color: var(--accent-primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--transition-fast);
}

:deep(.markdown-body a:hover) {
  border-bottom-color: var(--accent-primary);
}

/* 暂停标记 */
.pause-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--border-subtle);
}

.pause-dot {
  width: 8px;
  height: 8px;
  background: linear-gradient(135deg, #F97316 0%, #FBBF24 100%);
  border-radius: 50%;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.9);
  }
}

.pause-text {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-style: italic;
}

/* 响应式 */
@media (max-width: 768px) {
  .bubble {
    max-width: 90%;
    padding: var(--space-3) var(--space-4);
  }
  
  .actions {
    opacity: 1;
  }
}
</style>
