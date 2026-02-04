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

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 切换侧边栏事件 */
  toggleSidebar: []
}>()

/** 聊天状态管理 */
const store = useChatStore()
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
          <h1 class="session-title">{{ store.currentSession?.title ?? '新对话' }}</h1>
          <span class="status-indicator">
            <span class="status-dot"></span>
            在线
          </span>
        </div>
      </div>

      <!-- 右侧操作 -->
      <div class="header-right">
        <button class="icon-btn" title="清空对话" @click="store.clearChat" aria-label="清空对话">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18"></path>
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.header {
  padding: var(--space-4) var(--space-6);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 900px;
  margin: 0 auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
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
}

.session-title {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.status-dot {
  width: 6px;
  height: 6px;
  background: var(--success);
  border-radius: var(--radius-full);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 响应式 */
@media (max-width: 768px) {
  .header {
    padding: var(--space-3) var(--space-4);
  }
  
  .icon-btn.menu {
    display: flex;
  }
  
  .session-title {
    font-size: var(--text-base);
  }
}
</style>
