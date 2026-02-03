<script setup lang="ts">
/**
 * 单条消息组件 - 《反主流》美学
 * 
 * 有机气泡、温暖交互
 */
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

interface Props {
  role: 'user' | 'assistant' | 'system'
  content: string
  index: number
  isPaused?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  delete: [index: number]
}>()

const md = new MarkdownIt()
const htmlContent = computed(() => md.render(props.content))
const isUser = computed(() => props.role === 'user')

function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.classList.contains('copy-code-btn')) return

  const code = target.getAttribute('data-code')
  if (!code) return

  navigator.clipboard.writeText(code).then(() => {
    const original = target.textContent ?? '复制'
    target.textContent = '已复制!'
    target.classList.add('copied')

    setTimeout(() => {
      target.textContent = original
      target.classList.remove('copied')
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
      <div v-else class="user-text">{{ content }}</div>

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
  padding: var(--space-4) var(--space-5);
  line-height: 1.7;
  border-radius: var(--radius-xl);
  transition: all var(--transition-fast);
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

/* 用户文本 */
.user-text {
  font-size: var(--text-base);
  white-space: pre-wrap;
  word-break: break-word;
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
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-xs);
  font-weight: 500;
  color: white;
  background: var(--accent-primary);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

:deep(.copy-code-btn:hover) {
  background: var(--accent-primary-hover);
  transform: translateY(-1px);
}

:deep(.copy-code-btn.copied) {
  background: var(--success);
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
