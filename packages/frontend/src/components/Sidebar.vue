<script setup lang="ts">
/**
 * 侧边栏组件
 * 功能：会话列表、系统提示词设置、主题切换
 */
import { ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useTheme } from '../composables/useTheme'

// ==================== Props ====================

interface Props {
  isOpen: boolean
}

defineProps<Props>()

// ==================== Store & Composables ====================

const store = useChatStore()
const { theme, setTheme } = useTheme()

// ==================== 系统提示词 ====================

const showSystemPrompt = ref(false)
const systemPromptInput = ref('')

// 切换会话时同步系统提示词
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

// ==================== 时间格式化 ====================

const TIME_CONSTANTS = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  TWO_DAYS: 48 * 60 * 60 * 1000
} as const

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 今天
  if (diff < TIME_CONSTANTS.ONE_DAY && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  // 昨天
  if (diff < TIME_CONSTANTS.TWO_DAYS) {
    return '昨天'
  }

  // 今年
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }

  // 其他年份
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-open': isOpen }">
    <!-- 头部 -->
    <div class="sidebar-header">
      <div class="app-logo">
        <h2>AI 助手</h2>
      </div>
      <button class="new-chat-btn" @click="store.createSession()">
        <span class="btn-icon">+</span>
        <span>新建对话</span>
      </button>
    </div>

    <!-- 系统提示词设置 -->
    <div class="system-prompt-section">
      <button
        class="prompt-toggle-btn"
        @click="showSystemPrompt = !showSystemPrompt"
      >
        <span class="btn-icon">⚙️</span>
        <span>{{ showSystemPrompt ? '收起人设设置' : '设置助手人设' }}</span>
      </button>

      <div v-if="showSystemPrompt" class="prompt-editor">
        <textarea
          v-model="systemPromptInput"
          placeholder="例如：你是一个资深的程序员，说话简洁专业..."
          class="prompt-textarea"
          rows="4"
        />
        <button class="save-prompt-btn" @click="saveSystemPrompt">
          <span class="btn-icon">💾</span>
          <span>保存设置</span>
        </button>
      </div>
    </div>

    <!-- 会话列表 -->
    <div class="session-list">
      <div class="list-header">
        <h3>对话历史</h3>
        <span class="session-count">{{ store.sessions.length }}</span>
      </div>

      <div
        v-for="session in store.sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === store.currentSessionId }"
        @click="store.switchSession(session.id)"
      >
        <div class="session-info">
          <span class="session-title" :title="session.title">
            {{ session.title }}
          </span>
          <span class="session-time">{{ formatTime(session.updatedAt) }}</span>
        </div>
        <button
          class="delete-btn"
          title="删除会话"
          @click.stop="store.deleteSession(session.id)"
        >
          ×
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="store.sessions.length === 0" class="empty-sessions">
        <div class="empty-icon">💬</div>
        <p>还没有对话历史</p>
        <p class="empty-hint">开始一个新的对话吧</p>
      </div>
    </div>

    <!-- 底部设置 -->
    <div class="sidebar-footer">
      <div class="footer-section">
        <h4>主题设置</h4>
        <div class="theme-toggle">
          <button
            class="theme-btn"
            :class="{ active: theme === 'light' }"
            @click="setTheme('light')"
          >
            ☀️ 浅色
          </button>
          <button
            class="theme-btn"
            :class="{ active: theme === 'dark' }"
            @click="setTheme('dark')"
          >
            🌙 深色
          </button>
        </div>
      </div>

      <div class="footer-section">
        <h4>关于</h4>
        <p class="version-info">版本 1.0.0</p>
      </div>
    </div>
  </aside>
</template>
