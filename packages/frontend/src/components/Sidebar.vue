<script setup lang="ts">
/**
 * 侧边栏组件
 * 功能：展示对话历史列表、系统提示词设置、主题切换
 */
import { useChatStore } from '../stores/chat'
import { ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

// ==================== Store & Composable ====================

/** 初始化 Pinia Store，管理聊天会话状态 */
const store = useChatStore()

/** 使用主题 composable，获取当前主题和切换方法 */
const { theme, handleThemeChange } = useTheme()

// ==================== 系统提示词相关 ====================

/** 控制系统提示词面板的显示/隐藏 */
const showSystemPrompt = ref(false)

/** 系统提示词输入框的绑定值 */
const systemPromptInput = ref('')

/**
 * 格式化时间戳为友好显示格式
 * @param timestamp - 时间戳（毫秒）
 * @returns 格式化后的时间字符串
 * - 今天：显示具体时间（如 14:30）
 * - 昨天：显示"昨天"
 * - 今年：显示月日（如 01-30）
 * - 其他：显示完整日期（如 2024-01-30）
 */
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // 今天：显示具体时间
  if (diff < 24 * 60 * 60 * 1000 && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  // 昨天
  else if (diff < 48 * 60 * 60 * 1000) {
    return '昨天 '
  }
  // 今年：显示月日
  else if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  // 其他年份：显示完整日期
  else {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }
}

/**
 * 监听当前会话变化，同步更新系统提示词输入框
 * immediate: true 确保初始化时也执行一次
 */
watch(
  () => store.currentSessionId,
  () => {
    systemPromptInput.value = store.currentSession?.systemPrompt || ''
  },
  { immediate: true }
)

/**
 * 保存系统提示词到当前会话
 * 保存成功后关闭面板并提示用户
 */
const saveSystemPrompt = () => {
  if (store.currentSessionId) {
    store.updateSystemPrompt(store.currentSessionId, systemPromptInput.value)
    showSystemPrompt.value = false
    alert('人设设置成功！下次发送消息时生效。')
  }
}

// ==================== Props ====================

/** 组件 Props 定义 */
defineProps<{
  /** 控制侧边栏的展开/收起状态 */
  isOpen: boolean
}>()
</script>

<template>
  <!-- 侧边栏容器：根据 isOpen 控制展开/收起 -->
  <aside class="sidebar" :class="{ 'sidebar-open': isOpen }">
    <!-- 顶部区域：Logo 和新建对话按钮 -->
    <div class="sidebar-header">
      <div class="app-logo">
        <h2>AI 助手</h2>
      </div>
      <button class="new-chat-btn" @click="store.createSession()">
        <span class="btn-icon">+</span>
        <span>新建对话</span>
      </button>
    </div>

    <!-- 系统提示词设置区域 -->
    <div class="system-prompt-section">
      <!-- 展开/收起按钮 -->
      <button class="prompt-toggle-btn" @click="showSystemPrompt = !showSystemPrompt">
        <span class="btn-icon">⚙️</span>
        <span>{{ showSystemPrompt ? '收起人设设置' : '设置助手人设' }}</span>
      </button>
      <!-- 提示词编辑面板（条件渲染） -->
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

    <!-- 对话历史列表区域 -->
    <div class="session-list">
      <!-- 列表头部：标题和会话数量 -->
      <div class="list-header">
        <h3>对话历史</h3>
        <span class="session-count">{{ store.sessions.length }}</span>
      </div>
      <!-- 会话列表项 -->
      <div
        v-for="session in store.sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === store.currentSessionId }"
        @click="store.switchSession(session.id)"
      >
        <div class="session-info">
          <!-- 会话标题（带 tooltip） -->
          <span class="session-title" :title="session.title">{{ session.title }}</span>
          <!-- 最后更新时间 -->
          <span class="session-time">{{ formatTime(session.updatedAt || session.createdAt) }}</span>
        </div>
        <!-- 删除按钮（阻止事件冒泡，避免触发切换会话） -->
        <button class="delete-btn" @click.stop="store.deleteSession(session.id)" title="删除会话">
          <span>×</span>
        </button>
      </div>
      <!-- 空状态提示 -->
      <div v-if="store.sessions.length === 0" class="empty-sessions">
        <div class="empty-icon">💬</div>
        <p>还没有对话历史</p>
        <p class="empty-hint">开始一个新的对话吧</p>
      </div>
    </div>

    <!-- 侧边栏底部：主题切换和版本信息 -->
    <div class="sidebar-footer">
      <!-- 主题切换区域 -->
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
      <!-- 版本信息 -->
      <div class="footer-section">
        <h4>关于</h4>
        <p class="version-info">版本 1.0.0</p>
      </div>
    </div>
  </aside>
</template>
