<script setup lang="ts">
/**
 * 聊天头部组件
 * 显示当前会话标题和功能按钮
 */
import { useChatStore } from '../stores/chat'

// ==================== Emits ====================

const emit = defineEmits<{
  toggleSidebar: []
}>()

// ==================== Store ====================

const store = useChatStore()
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <button class="menu-btn" @click="emit('toggleSidebar')">
        <span>☰</span>
      </button>
      <h1>{{ store.currentSession?.title ?? 'AI 助手' }}</h1>
    </div>

    <div class="header-right">
      <button class="header-btn" title="清空对话" @click="store.clearChat">
        <span>🗑️</span>
      </button>
      <button class="header-btn" title="帮助">
        <span>❓</span>
      </button>
    </div>
  </header>
</template>
