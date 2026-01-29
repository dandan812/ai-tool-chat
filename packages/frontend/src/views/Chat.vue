<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import ChatInput from '../components/ChatInput.vue'
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import { ref } from 'vue'
import './Chat.css'

const store = useChatStore()
const isSidebarOpen = ref(false)

const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}
</script>

<template>
  <div class="app-layout">
    <div v-if="isSidebarOpen" class="sidebar-overlay" @click="isSidebarOpen = false"></div>
    <Sidebar :isOpen="isSidebarOpen" />
    <div class="chat-layout">
      <ChatHeader :onToggleSidebar="toggleSidebar" />
      <ChatMessages />
      <footer class="chat-footer">
        <div class="input-container">
          <ChatInput
            :loading="store.isLoading"
            @send="store.sendMessage"
            @stop="store.stopGeneration"
          />
        </div>
      </footer>
    </div>
  </div>
</template>