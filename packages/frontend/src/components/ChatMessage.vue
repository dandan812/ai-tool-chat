<script setup lang="ts">
/**
 * 单条消息组件
 *
 * 目标：
 * - 强化用户消息与 AI 消息的层级差异
 * - 把操作入口收回消息头部，减少悬浮抖动
 * - 继续保留 Markdown 和代码复制能力
 *
 * @package frontend/src/components
 */

import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

interface Props {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 消息索引 */
  index: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 删除消息 */
  delete: [index: number]
}>()

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
 * HTML 转义
 * @param text 原始文本
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
 * HTML 属性转义
 * @param text 原始文本
 */
function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

/** 渲染后的 HTML */
const htmlContent = computed(() => md.render(props.content))

/** 是否为用户消息 */
const isUser = computed(() => props.role === 'user')

/** 消息角色文案 */
const roleLabel = computed(() => (isUser.value ? '你' : 'AI 助手'))

/**
 * 处理代码复制按钮点击
 * @param event 鼠标事件
 */
function handleClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const button = target.closest('.copy-code-btn') as HTMLElement | null
  if (!button) return

  const code = button.getAttribute('data-code')
  if (!code) return

  navigator.clipboard.writeText(code).then(() => {
    const buttonText = button.querySelector('.btn-text')
    const originalText = buttonText?.textContent ?? '复制'

    if (buttonText) {
      buttonText.textContent = '已复制'
    }

    button.classList.add('copied')

    setTimeout(() => {
      if (buttonText) {
        buttonText.textContent = originalText
      }
      button.classList.remove('copied')
    }, 1800)
  })
}
</script>

<template>
  <article class="message-row" :class="{ user: isUser, ai: !isUser }">
    <div class="avatar" :aria-label="roleLabel">
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

    <div class="message-frame">
      <div class="message-meta">
        <span class="role-badge">{{ roleLabel }}</span>
        <span class="message-index">第 {{ index + 1 }} 条</span>

        <button
          class="delete-btn"
          type="button"
          title="删除消息"
          @click="emit('delete', index)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          </svg>
        </button>
      </div>

      <div class="bubble">
        <div
          class="markdown-body"
          :class="{ 'user-text': isUser }"
          v-html="htmlContent"
          @click="handleClick"
        />
      </div>
    </div>
  </article>
</template>

<style scoped>
.message-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
  animation: slide-in var(--transition-base) ease-out;
}

.message-row.user {
  grid-template-columns: minmax(0, 1fr) 40px;
}

.message-row.user .avatar {
  grid-column: 2;
  justify-self: end;
}

.message-row.user .message-frame {
  grid-column: 1;
}

.avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  flex-shrink: 0;
}

.message-row.ai .avatar {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  box-shadow: var(--shadow-warm);
}

.message-row.user .avatar {
  background: var(--message-user-bg);
  color: var(--message-user-text);
}

.message-frame {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.message-row.user .message-frame {
  align-items: flex-end;
}

.message-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.message-row.user .message-meta {
  flex-direction: row-reverse;
}

.role-badge,
.message-index {
  font-size: var(--text-xs);
  font-weight: 700;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0.15rem 0.55rem;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.message-row.ai .role-badge {
  color: var(--accent-primary);
  background: var(--accent-soft);
}

.message-index {
  color: var(--text-tertiary);
}

.delete-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  opacity: 0;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.message-row.user .delete-btn {
  margin-left: 0;
  margin-right: auto;
}

.message-frame:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  border-color: rgba(239, 68, 68, 0.16);
  background: var(--danger-soft);
  color: var(--error);
}

.bubble {
  width: min(100%, var(--layout-message-max));
  padding: 1.05rem 1.15rem;
  border-radius: 22px;
  overflow-wrap: break-word;
}

.message-row.ai .bubble {
  background: var(--message-ai-bg);
  border: 1px solid var(--message-ai-border);
  box-shadow: var(--shadow-panel);
}

.message-row.user .bubble {
  max-width: min(100%, 700px);
  background: var(--message-user-bg);
  color: var(--message-user-text);
  border: 1px solid var(--message-user-border);
  box-shadow: 0 10px 26px rgba(34, 29, 24, 0.06);
  border-bottom-right-radius: var(--radius-sm);
}

.markdown-body {
  width: 100%;
  min-width: 0;
  line-height: 1.75;
  color: inherit;
  overflow-wrap: break-word;
}

.user-text {
  color: inherit;
}

:deep(.markdown-body p) {
  margin: 0 0 var(--space-3);
}

:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

:deep(.markdown-body ul),
:deep(.markdown-body ol) {
  margin: var(--space-3) 0;
  padding-left: var(--space-6);
}

:deep(.markdown-body li) {
  margin-bottom: var(--space-2);
}

:deep(.markdown-body a) {
  color: var(--accent-primary);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--transition-fast);
}

:deep(.markdown-body a:hover) {
  border-bottom-color: var(--accent-primary);
}

:deep(.markdown-body code) {
  padding: 0.12rem 0.38rem;
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  color: var(--accent-primary);
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 0.9em;
}

:deep(.markdown-body pre code) {
  padding: 0;
  color: inherit;
  background: transparent;
}

:deep(.code-block-wrapper) {
  margin: var(--space-4) 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: #111111;
}

:deep(.code-block-header) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.65rem 0.9rem;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

:deep(.code-lang) {
  color: rgba(255, 255, 255, 0.72);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

:deep(.copy-code-btn) {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.28rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-pill);
  background: transparent;
  color: rgba(255, 255, 255, 0.78);
  font-size: var(--text-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

:deep(.copy-code-btn:hover) {
  background: rgba(255, 255, 255, 0.08);
}

:deep(.copy-code-btn.copied) {
  color: white;
  background: rgba(34, 197, 94, 0.22);
  border-color: rgba(34, 197, 94, 0.26);
}

:deep(.markdown-body pre) {
  margin: 0;
  padding: var(--space-4);
  overflow-x: auto;
  color: rgba(255, 255, 255, 0.92);
  background: transparent;
  font-family: 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: var(--text-sm);
  line-height: 1.65;
}

.message-row.user :deep(.markdown-body code) {
  color: inherit;
  background: rgba(255, 255, 255, 0.12);
}

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .message-row {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  .message-row.user {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .avatar {
    width: 36px;
    height: 36px;
  }

  .bubble,
  .message-row.user .bubble {
    width: 100%;
    max-width: 100%;
    padding: var(--space-4);
  }

  .delete-btn {
    opacity: 1;
  }
}
</style>
