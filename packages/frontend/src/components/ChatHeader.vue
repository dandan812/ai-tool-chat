<script setup lang="ts">
import { useChatStore } from '../stores/chat'

// 初始化 Pinia Store
const store = useChatStore()

// 定义 props
const props = defineProps<{
  onToggleSidebar: () => void
}>()
</script>

<template>
  <header class="chat-header">
    <div class="header-left">
      <button class="menu-btn" @click="props.onToggleSidebar">
        <span>☰</span>
      </button>
      <h1>{{ store.currentSession?.title || 'AI 助手' }}</h1>
    </div>
    <div class="header-right">
      <button @click="store.clearChat" class="header-btn" title="清空对话">
        <span>🗑️</span>
      </button>
      <button class="header-btn" title="帮助">
        <span>❓</span>
      </button>
    </div>
  </header>
</template>
