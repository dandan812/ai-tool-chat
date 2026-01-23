<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import ChatMessage from '../components/ChatMessage.vue'
import ChatInput from '../components/ChatInput.vue'
import { nextTick, ref, watch } from 'vue'

const store = useChatStore()
const messagesContainer = ref<HTMLElement | null>(null)

// 自动滚动到底部
const scrollToBottom = async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

watch(
  () => store.messages.length, 
  scrollToBottom
)

// 监听最后一条消息内容变化（流式输出时自动滚动）
watch(
  () => store.messages[store.messages.length - 1]?.content, 
  scrollToBottom,
  { deep: true }
)
</script>

<template>
  <div class="chat-layout">
    <header class="chat-header">
      <h1>AI 助手</h1>
      <button @click="store.clearChat" class="clear-btn" title="清空对话">🗑️</button>
    </header>

    <main class="chat-messages" ref="messagesContainer">
      <div v-if="store.messages.length === 0" class="empty-state">
        <p>开始一个新的对话吧！</p>
      </div>
      
      <ChatMessage
        v-for="(msg, index) in store.messages"
        :key="index"
        :role="msg.role"
        :content="msg.content"
      />
    </main>

    <footer class="chat-footer">
      <ChatInput
        :loading="store.isLoading"
        @send="store.sendMessage"
        @stop="store.stopGeneration"
      />
    </footer>
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #fff;
}

.chat-header {
  height: 60px;
  border-bottom: 1px solid #eaeaea;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: white;
  z-index: 10;
}

.chat-header h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.clear-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  padding: 8px;
  border-radius: 4px;
}

.clear-btn:hover {
  background: #f0f0f0;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #888;
}

.chat-footer {
  flex-shrink: 0;
}
</style>
