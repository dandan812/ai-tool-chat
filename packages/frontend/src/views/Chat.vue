<script setup lang="ts">
/**
 * 聊天主页面
 * 整合侧边栏、消息列表、输入框等组件
 */
import { ref } from 'vue'
import { useChatStore } from '../stores/chat'
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import './Chat.css'

const store = useChatStore()
const isSidebarOpen = ref(false)

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value
}

function closeSidebar() {
  isSidebarOpen.value = false
}
</script>

<template>
  <div class="app-layout">
    <!-- 移动端侧边栏遮罩 -->
    <div v-if="isSidebarOpen" class="sidebar-overlay" @click="closeSidebar" />

    <!-- 侧边栏 -->
    <Sidebar :is-open="isSidebarOpen" />

    <!-- 主聊天区域 -->
    <div class="chat-layout">
      <ChatHeader @toggle-sidebar="toggleSidebar" />

      <ChatMessages />

      <footer class="chat-footer">
        <ChatInput
          :loading="store.isLoading"
          @send="store.sendMessage"
          @stop="store.stopGeneration"
        />
      </footer>
    </div>
  </div>
</template>
