<script setup lang="ts">
/**
 * 聊天头部组件 - 《反主流》美学
 *
 * 设计理念：
 * 简洁、有温度的头部设计
 *
 * 功能特性：
 * - 显示当前会话标题
 * - 显示在线状态指示
 * - 切换侧边栏按钮（移动端）
 * - 清空当前对话按钮
 *
 * @package frontend/src/components
 */

import { useChatStore } from '../stores/chat'
import { computed } from 'vue'

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 切换侧边栏事件 */
  toggleSidebar: []
}>()

/** 聊天状态管理 */
const store = useChatStore()

const currentTask = computed(() => store.getCurrentTask(store.currentSessionId))
const currentModel = computed(() => {
  const model = currentTask.value?.metadata?.model
  return typeof model === 'string' && model ? model : '等待输入'
})

const currentStatus = computed(() => {
  if (store.isSessionLoading(store.currentSessionId)) return '执行中'
  if (currentTask.value?.status === 'failed') return '需重试'
  if (currentTask.value?.status === 'completed') return '已完成'
  return '准备就绪'
})
</script>

<template>
  <header class="header">
    <div class="header-content">
      <!-- 左侧 -->
      <div class="header-left">
        <button class="icon-btn menu" @click="emit('toggleSidebar')" aria-label="菜单">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        
        <div class="title-group">
          <span class="eyebrow">AI 工作台</span>
          <h1 class="session-title">{{ store.currentSession?.title ?? '新对话' }}</h1>
          <div class="status-row">
            <span class="status-indicator" :class="{ active: store.isSessionLoading(store.currentSessionId) }">
              <span class="status-dot"></span>
              {{ currentStatus }}
            </span>
            <span class="model-chip">{{ currentModel }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧操作 -->
      <div class="header-right">
        <button class="clear-btn" title="清空当前会话" @click="store.clearChat" aria-label="清空对话">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
          <span>清空</span>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  padding: var(--space-5) var(--space-6) var(--space-4);
  background: transparent;
  border-bottom: 1px solid var(--border-subtle);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  width: min(100%, var(--layout-content-max));
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: transparent;
  color: var(--text-secondary);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.icon-btn.menu {
  display: none;
}

.title-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.eyebrow {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  font-weight: 600;
}

.session-title {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-weight: 600;
  padding: 0.3rem 0.6rem;
  background: var(--surface-muted);
  border-radius: var(--radius-pill);
}

.status-indicator.active {
  color: var(--accent-primary);
  background: var(--accent-soft);
}

.status-dot {
  width: 6px;
  height: 6px;
  background: currentColor;
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

.model-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0.3rem 0.65rem;
  border-radius: var(--radius-pill);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-shrink: 0;
}

.clear-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.7rem 0.95rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  backdrop-filter: blur(12px);
}

.clear-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 响应式 */
@media (max-width: 768px) {
  .header {
    padding: var(--space-4) var(--space-4) var(--space-3);
  }
  
  .icon-btn.menu {
    display: flex;
  }
  
  .header-content {
    gap: var(--space-3);
  }

  .session-title {
    font-size: var(--text-lg);
  }

  .clear-btn span {
    display: none;
  }
}
</style>
