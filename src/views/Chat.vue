<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import ChatMessage from '../components/ChatMessage.vue'
import ChatInput from '../components/ChatInput.vue'
import { nextTick, ref, watch } from 'vue'

// 初始化 Pinia Store
const store = useChatStore()

// 获取消息容器的 DOM 引用，用于控制滚动
// ref 绑定到模板中的 <main class="chat-messages" ref="messagesContainer">
const messagesContainer = ref<HTMLElement | null>(null)

// 自动滚动到底部的函数
const scrollToBottom = async () => {
  // await nextTick()：等待 Vue 完成 DOM 更新
  // 必须等待，否则滚动高度还是旧的（未添加新消息前的高度）
  await nextTick() 
  if (messagesContainer.value) {
    // 设置 scrollTop 为 scrollHeight，即滚动到最底部
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

// 1. 监听消息列表长度变化
// 场景：当用户发送消息或开始新对话时，自动滚动到底部
watch(
  () => store.messages.length, 
  scrollToBottom
)

// 2. 监听最后一条消息的内容变化
// 场景：当 AI 正在流式输出（打字机效果）时，内容不断变长，需要实时跟随滚动
watch(
  () => store.messages[store.messages.length - 1]?.content, 
  scrollToBottom,
  { deep: true } // 深度监听，确保对象属性变化也能触发
)
</script>

<template>
  <div class="chat-layout">
    <!-- 顶部标题栏 -->
    <header class="chat-header">
      <h1>AI 助手</h1>
      <!-- 清空对话按钮 -->
      <button @click="store.clearChat" class="clear-btn" title="清空对话">🗑️</button>
    </header>

    <!-- 消息列表区域 -->
    <!-- ref="messagesContainer" 用于在脚本中获取该元素以控制滚动 -->
    <main class="chat-messages" ref="messagesContainer">
      <!-- 空状态提示：当没有消息时显示 -->
      <div v-if="store.messages.length === 0" class="empty-state">
        <p>开始一个新的对话吧！</p>
      </div>
      
      <!-- 消息列表渲染 -->
      <ChatMessage
        v-for="(msg, index) in store.messages"
        :key="index"
        :role="msg.role"
        :content="msg.content"
      />
    </main>

    <!-- 底部输入区域 -->
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
  height: 100%; /* 使用 100% 继承父容器高度，避免 100vh 导致的潜在溢出 */
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
