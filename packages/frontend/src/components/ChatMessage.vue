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
import { handleMessageMarkdownClick, renderMessageMarkdown } from '../utils/messageMarkdown'
import { useChatStore } from '../stores/chat'

interface Props {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 消息索引 */
  index: number
}

const props = defineProps<Props>()
const store = useChatStore()

const emit = defineEmits<{
  /** 删除消息 */
  delete: [index: number]
}>()

/** 渲染后的 HTML */
const htmlContent = computed(() => renderMessageMarkdown(props.content))

/** 是否为用户消息 */
const isUser = computed(() => props.role === 'user')

/** 消息角色文案 */
const roleLabel = computed(() => (isUser.value ? '你' : 'AI 助手'))

/** AI 空消息占位态 */
const showPendingPlaceholder = computed(() => {
  return (
    props.role === 'assistant' &&
    !props.content.trim() &&
    !!store.currentSessionId &&
    store.isSessionLoading(store.currentSessionId)
  )
})

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
        <div v-if="showPendingPlaceholder" class="pending-placeholder">
          正在生成内容...
        </div>
        <div
          v-else
          class="markdown-body"
          :class="{ 'user-text': isUser }"
          v-html="htmlContent"
          @click="handleMessageMarkdownClick"
        />
      </div>
    </div>
  </article>
</template>

<style scoped>
.message-row {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding-left: 56px;
  animation: slide-in var(--transition-base) ease-out;
}

.message-row.user {
  justify-content: flex-end;
  padding-left: 0;
  padding-right: 56px;
}

.avatar {
  position: absolute;
  top: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  flex-shrink: 0;
}

.message-row.ai .avatar {
  left: 0;
}

.message-row.ai .avatar {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  color: white;
  box-shadow: var(--shadow-warm);
}

.message-row.user .avatar {
  right: 0;
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
  width: min(100%, var(--layout-message-max));
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
  width: 100%;
  padding: 1.05rem 1.15rem;
  border-radius: 22px;
  overflow-wrap: break-word;
}

.message-row.ai .bubble {
  background: var(--message-ai-bg);
  border: 1px solid var(--message-ai-border);
  box-shadow: var(--shadow-panel);
}

.pending-placeholder {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  line-height: 1.7;
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
    padding-left: 44px;
  }

  .message-row.user {
    padding-left: 0;
    padding-right: 44px;
  }

  .avatar {
    position: absolute;
    width: 36px;
    height: 36px;
  }

   .message-row.ai .avatar {
    left: 0;
  }

  .message-row.user .avatar {
    right: 0;
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
