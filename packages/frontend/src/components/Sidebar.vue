<script setup lang="ts">
/**
 * 侧边栏组件
 *
 * 目标：
 * - 让侧边栏更像工作区导航，而不是单纯的列表
 * - 强化品牌、当前会话和主操作的层级
 *
 * @package frontend/src/components
 */

import { useChatStore } from '../stores/chat'
import { useTheme } from '../composables/useTheme'
import SidebarSessionItem from './SidebarSessionItem.vue'
import { SIDEBAR_THEME_OPTIONS } from '../utils/sidebarPresentation'

interface Props {
  /** 侧边栏是否展开（移动端） */
  isOpen: boolean
}

defineProps<Props>()

const store = useChatStore()
const { theme, setTheme } = useTheme()
</script>

<template>
  <aside class="sidebar" :class="{ 'is-open': isOpen }">
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" fill="currentColor" opacity="0.12" />
            <path
              d="M12 16C12 13.7909 13.7909 12 16 12H24C26.2091 12 28 13.7909 28 16V22C28 24.2091 26.2091 26 24 26H20L14 30V26H12C9.79086 26 8 24.2091 8 22V16C8 13.7909 9.79086 12 12 12"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle cx="15" cy="19" r="1.5" fill="currentColor" />
            <circle cx="20" cy="19" r="1.5" fill="currentColor" />
            <circle cx="25" cy="19" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <div class="brand-copy">
          <span class="brand-name">AI Tool Chat</span>
        </div>
      </div>

      <button class="new-chat-btn" @click="store.createSession()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        新对话
      </button>
    </div>

    <div class="session-list">
      <div class="list-header">
        <span class="list-title">对话历史</span>
        <span class="list-count">{{ store.sessions.length }}</span>
      </div>

      <SidebarSessionItem
        v-for="session in store.sessions"
        :key="session.id"
        :title="session.title"
        :updated-at="session.updatedAt"
        :active="session.id === store.currentSessionId"
        @select="store.switchSession(session.id)"
        @delete="store.deleteSession(session.id)"
      />

      <div v-if="store.sessions.length === 0" class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>还没有会话</p>
        <span>从一个清晰的问题开始，会更像真正的工作流。</span>
      </div>
    </div>

    <div class="sidebar-footer">
      <div class="setting-group">
        <span class="setting-label">主题</span>
        <div class="theme-switch">
          <button
            v-for="option in SIDEBAR_THEME_OPTIONS"
            :key="option.value"
            class="theme-option"
            :class="{ active: theme === option.value }"
            @click="setTheme(option.value)"
            :aria-label="option.label"
          >
            <svg v-if="option.value === 'light'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="footer-meta">
        <span class="version">v1.3.0</span>
        
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--layout-sidebar-width);
  height: 100%;
  background: linear-gradient(180deg, var(--surface-panel) 0%, var(--sidebar-bg) 100%);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-slow);
  backdrop-filter: blur(18px);
}

.sidebar-header {
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.28), transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.brand-mark {
  width: 42px;
  height: 42px;
  color: var(--accent-primary);
  flex-shrink: 0;
}

.brand-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.brand-kicker {
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  font-weight: 700;
}

.brand-name {
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}

.new-chat-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-muted);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 10px 24px rgba(34, 29, 24, 0.06);
}

.new-chat-btn:hover {
  background: #eee7dd;
  border-color: var(--message-user-border);
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(34, 29, 24, 0.08);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4);
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-2);
  margin-bottom: var(--space-3);
}

.list-title {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.list-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  padding: 0.2rem 0.5rem;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--surface-muted);
  border-radius: var(--radius-pill);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-12) var(--space-4);
  color: var(--text-muted);
  text-align: center;
}

.empty-state svg {
  opacity: 0.28;
}

.empty-state p {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-weight: 600;
}

.empty-state span {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  line-height: 1.6;
  max-width: 180px;
}

.sidebar-footer {
  padding: var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.28));
}

.setting-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.setting-label {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.theme-switch {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-1);
  background: var(--surface-muted);
  border-radius: var(--radius-pill);
}

.theme-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-option:hover {
  color: var(--text-primary);
}

.theme-option.active {
  background: var(--surface-strong);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.footer-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-top: var(--space-4);
}

.version {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  text-align: center;
  font-weight: 600;
}

.footer-caption {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-align: center;
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    transform: translateX(-100%);
    z-index: 60;
  }

  .sidebar.is-open {
    transform: translateX(0);
  }
}
</style>
