<script setup lang="ts">
/**
 * 聊天头部组件
 * 功能：显示当前会话标题、侧边栏切换按钮、清空对话等功能按钮
 */
import { useChatStore } from '../stores/chat'

// ==================== Store ====================

/** 初始化 Pinia Store，获取当前会话信息 */
const store = useChatStore()

// ==================== Props ====================

/** 组件 Props 定义 */
defineProps<{
  /** 切换侧边栏显示状态的回调函数 */
  onToggleSidebar: () => void
}>()
</script>

<template>
  <!-- 页面头部容器 -->
  <header class="chat-header">
    <!-- 左侧区域：菜单按钮和标题 -->
    <div class="header-left">
      <!-- 侧边栏切换按钮 -->
      <button class="menu-btn" @click="props.onToggleSidebar">
        <span>☰</span>
      </button>
      <!-- 当前会话标题：如果没有则显示默认标题 -->
      <h1>{{ store.currentSession?.title || 'AI 助手' }}</h1>
    </div>
    <!-- 右侧区域：功能按钮 -->
    <div class="header-right">
      <!-- 清空对话按钮 -->
      <button @click="store.clearChat" class="header-btn" title="清空对话">
        <span>🗑️</span>
      </button>
      <!-- 帮助按钮（预留） -->
      <button class="header-btn" title="帮助">
        <span>❓</span>
      </button>
    </div>
  </header>
</template>
