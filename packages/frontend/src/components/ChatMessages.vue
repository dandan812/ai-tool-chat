<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import ChatMessage from './ChatMessage.vue'
import { watch } from 'vue'
import { useScroll } from '../composables/useScroll'

// 初始化 Pinia Store
const store = useChatStore()

// 使用滚动 composable
const { container: messagesContainer, scrollToBottom, shouldAutoScroll } = useScroll()

// 1. 监听消息列表长度变化
// 场景：当用户发送消息或开始新对话时，自动滚动到底部
watch(() => store.messages.length, scrollToBottom)

// 2. 监听最后一条消息的内容变化
// 场景：当 AI 正在流式输出（打字机效果）时，内容不断变长，需要实时跟随滚动
watch(
  () => store.messages[store.messages.length - 1]?.content,
  () => {
    // 只有当用户没有向上滚动查看历史消息时，才自动滚动到底部
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  },
  { deep: true } // 深度监听，确保对象属性变化也能触发
)
</script>

<template>
  <main class="chat-messages" ref="messagesContainer">
    <!-- 空状态提示：当没有消息时显示 -->
    <div v-if="store.messages.length === 0" class="empty-state">
      <h2>你好！我是你的 AI 助手</h2>
      <p>有什么我可以帮助你的吗？</p>
      <div class="suggestions">
        <button
          class="suggestion-btn"
          @click="store.sendMessage('给我一个简单的 JavaScript 代码示例')"
        >
          给我一个简单的代码示例
        </button>
        <button class="suggestion-btn" @click="store.sendMessage('解释一下什么是 Vue 3')">
          解释一下 Vue 3
        </button>
        <button class="suggestion-btn" @click="store.sendMessage('帮我写一个前端简历模板')">
          帮我写一个简历模板
        </button>
      </div>
    </div>

    <!-- 消息列表渲染 -->
    <ChatMessage
      v-for="(msg, index) in store.messages"
      :key="index"
      :index="index"
      :role="msg.role"
      :content="msg.content"
      @delete="store.deleteMessage"
    />

    <!-- 加载状态 -->
    <div v-if="store.isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>AI 正在思考...</p>
    </div>
  </main>
</template>
