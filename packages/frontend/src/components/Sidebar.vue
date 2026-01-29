<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import { ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

// 初始化 Pinia Store
const store = useChatStore()

// 使用主题 composable
const { theme, handleThemeChange } = useTheme()

// 控制系统提示词面板显示
const showSystemPrompt = ref(false)
const systemPromptInput = ref('')

// 格式化时间
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 今天
  if (diff < 24 * 60 * 60 * 1000 && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 昨天
  else if (diff < 48 * 60 * 60 * 1000) {
    return '昨天 '
  }
  // 今年
  else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  // 其他
  else {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }
}

// 当切换会话时，更新系统提示词
watch(
  () => store.currentSessionId,
  () => {
    systemPromptInput.value = store.currentSession?.systemPrompt || ''
  },
  { immediate: true }
)

const saveSystemPrompt = () => {
  if (store.currentSessionId) {
    store.updateSystemPrompt(store.currentSessionId, systemPromptInput.value)
    showSystemPrompt.value = false
    alert('人设设置成功！下次发送消息时生效。')
  }
}

// 定义 props
defineProps<{
  isOpen: boolean
}>()
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar-open': isOpen }">
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
      <button class="prompt-toggle-btn" @click="showSystemPrompt = !showSystemPrompt">
        <span class="btn-icon">⚙️</span>
        <span>{{ showSystemPrompt ? '收起人设设置' : '设置助手人设' }}</span>
      </button>
      <div v-if="showSystemPrompt" class="prompt-editor">
        <textarea
          v-model="systemPromptInput"
          placeholder="例如：你是一个资深的程序员，说话简洁专业..."
          class="prompt-textarea"
        ></textarea>
        <button @click="saveSystemPrompt" class="save-prompt-btn">
          <span class="btn-icon">💾</span>
          <span>保存设置</span>
        </button>
      </div>
    </div>

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
          <span class="session-title" :title="session.title">{{ session.title }}</span>
          <span class="session-time">{{ formatTime(session.updatedAt || session.createdAt) }}</span>
        </div>
        <button class="delete-btn" @click.stop="store.deleteSession(session.id)" title="删除会话">
          <span>×</span>
        </button>
      </div>
      <div v-if="store.sessions.length === 0" class="empty-sessions">
        <div class="empty-icon">💬</div>
        <p>还没有对话历史</p>
        <p class="empty-hint">开始一个新的对话吧</p>
      </div>
    </div>

    <!-- 侧边栏底部：主题切换 -->
    <div class="sidebar-footer">
      <div class="footer-section">
        <h4>主题设置</h4>
        <div class="theme-toggle">
          <button
            class="theme-btn"
            :class="{ active: theme === 'light' }"
            @click="handleThemeChange('light')"
          >
            ☀️ 浅色
          </button>
          <button
            class="theme-btn"
            :class="{ active: theme === 'dark' }"
            @click="handleThemeChange('dark')"
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
