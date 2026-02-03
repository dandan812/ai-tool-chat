<script setup lang="ts">
/**
 * 侧边栏组件 - 《反主流》美学
 * 
 * 温暖、有质感的侧边栏设计
 */
import { ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useTheme } from '../composables/useTheme'

interface Props {
  isOpen: boolean
}

defineProps<Props>()

const store = useChatStore()
const { theme, setTheme } = useTheme()

const showSystemPrompt = ref(false)
const systemPromptInput = ref('')

watch(
  () => store.currentSessionId,
  () => {
    systemPromptInput.value = store.currentSession?.systemPrompt ?? ''
  },
  { immediate: true }
)

function saveSystemPrompt() {
  if (store.currentSessionId) {
    store.updateSystemPrompt(store.currentSessionId, systemPromptInput.value)
    showSystemPrompt.value = false
  }
}

const TIME_CONSTANTS = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  TWO_DAYS: 48 * 60 * 60 * 1000
} as const

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < TIME_CONSTANTS.ONE_DAY && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  if (diff < TIME_CONSTANTS.TWO_DAYS) {
    return '昨天'
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }

  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <aside class="sidebar" :class="{ 'is-open': isOpen }">
    <!-- Logo 区域 -->
    <div class="sidebar-header">
      <div class="brand">
        <div class="brand-mark">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="20" cy="20" r="18" fill="currentColor" opacity="0.1"/>
            <path d="M12 16C12 13.7909 13.7909 12 16 12H24C26.2091 12 28 13.7909 28 16V22C28 24.2091 26.2091 26 24 26H20L14 30V26H12C9.79086 26 8 24.2091 8 22V16C8 13.7909 9.79086 12 12 12" 
                  stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="15" cy="19" r="1.5" fill="currentColor"/>
            <circle cx="20" cy="19" r="1.5" fill="currentColor"/>
            <circle cx="25" cy="19" r="1.5" fill="currentColor"/>
          </svg>
        </div>
        <span class="brand-name">Chat</span>
      </div>
      
      <button class="new-chat-btn" @click="store.createSession()">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        新对话
      </button>
    </div>

    <!-- 系统提示词 -->
    <div class="section">
      <button class="section-toggle" @click="showSystemPrompt = !showSystemPrompt">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        {{ showSystemPrompt ? '收起草稿' : '助手人设' }}
      </button>

      <div v-if="showSystemPrompt" class="prompt-editor">
        <textarea
          v-model="systemPromptInput"
          placeholder="例如：你是一个温暖的设计师朋友，说话亲切有创意..."
          rows="4"
        />
        <button class="save-btn" @click="saveSystemPrompt">
          保存设置
        </button>
      </div>
    </div>

    <!-- 会话列表 -->
    <div class="session-list">
      <div class="list-header">
        <span class="list-title">对话历史</span>
        <span class="list-count">{{ store.sessions.length }}</span>
      </div>

      <div
        v-for="session in store.sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === store.currentSessionId }"
        @click="store.switchSession(session.id)"
      >
        <div class="session-info">
          <span class="session-title">{{ session.title }}</span>
          <span class="session-time">{{ formatTime(session.updatedAt) }}</span>
        </div>
        <button class="delete-btn" @click.stop="store.deleteSession(session.id)">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="store.sessions.length === 0" class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <p>还没有对话</p>
        <span>开始新的对话吧</span>
      </div>
    </div>

    <!-- 底部设置 -->
    <div class="sidebar-footer">
      <div class="setting-group">
        <span class="setting-label">主题</span>
        <div class="theme-switch">
          <button 
            class="theme-option" 
            :class="{ active: theme === 'light' }"
            @click="setTheme('light')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
          </button>
          <button 
            class="theme-option" 
            :class="{ active: theme === 'dark' }"
            @click="setTheme('dark')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div class="version">v1.3.0</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 280px;
  height: 100%;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  transition: transform var(--transition-slow);
}

/* Header */
.sidebar-header {
  padding: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.brand-mark {
  width: 40px;
  height: 40px;
  color: var(--accent-primary);
}

.brand-name {
  font-family: var(--font-display);
  font-size: var(--text-xl);
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
  background: var(--accent-primary);
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: var(--shadow-warm);
}

.new-chat-btn:hover {
  background: var(--accent-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px -4px var(--accent-glow);
}

/* Section */
.section {
  padding: var(--space-3) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.section-toggle:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.prompt-editor {
  margin-top: var(--space-3);
  animation: fadeIn 200ms ease-out;
}

.prompt-editor textarea {
  width: 100%;
  padding: var(--space-3);
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-primary);
  resize: vertical;
  transition: all var(--transition-fast);
}

.prompt-editor textarea:focus {
  outline: none;
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 3px var(--input-focus-ring);
}

.save-btn {
  width: 100%;
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.save-btn:hover {
  background: var(--accent-primary);
  color: white;
}

/* Session List */
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-4);
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-3);
}

.list-title {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.list-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  background: var(--bg-tertiary);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-full);
}

.session-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-1);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.session-item:hover {
  background: var(--sidebar-hover);
}

.session-item.active {
  background: var(--sidebar-active);
  box-shadow: var(--shadow-sm);
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.session-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.delete-btn {
  opacity: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.session-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: var(--error);
}

/* Empty */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-10) var(--space-4);
  color: var(--text-muted);
  text-align: center;
}

.empty-state svg {
  margin-bottom: var(--space-4);
  opacity: 0.3;
}

.empty-state p {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-bottom: var(--space-1);
}

.empty-state span {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* Footer */
.sidebar-footer {
  padding: var(--space-5);
  border-top: 1px solid var(--border-subtle);
}

.setting-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.setting-label {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.theme-switch {
  display: flex;
  gap: var(--space-1);
  background: var(--bg-tertiary);
  padding: var(--space-1);
  border-radius: var(--radius-md);
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
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-option:hover {
  color: var(--text-primary);
}

.theme-option.active {
  background: var(--sidebar-active);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.version {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: center;
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Mobile */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: 0;
    top: 0;
    transform: translateX(-100%);
    z-index: 50;
  }
  
  .sidebar.is-open {
    transform: translateX(0);
  }
}
</style>
