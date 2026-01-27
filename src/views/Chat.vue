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
  <div class="app-layout">
    <!-- 侧边栏：会话列表 -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <button class="new-chat-btn" @click="store.createSession()">
          + 新建对话
        </button>
      </div>
      
      <div class="session-list">
        <div 
          v-for="session in store.sessions" 
          :key="session.id"
          class="session-item"
          :class="{ active: session.id === store.currentSessionId }"
          @click="store.switchSession(session.id)"
        >
          <span class="session-title" :title="session.title">{{ session.title }}</span>
          <button 
            class="delete-btn" 
            @click.stop="store.deleteSession(session.id)"
            title="删除会话"
          >
            ×
          </button>
        </div>
      </div>
    </aside>

    <!-- 主聊天区域 -->
    <div class="chat-layout">
      <!-- 顶部标题栏 -->
      <header class="chat-header">
        <h1>{{ store.currentSession?.title || 'AI 助手' }}</h1>
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
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 侧边栏样式 */
.sidebar {
  width: 260px;
  background-color: #f7f7f8;
  border-right: 1px solid #eaeaea;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 10px;
}

.new-chat-btn {
  width: 100%;
  padding: 10px;
  background-color: white;
  border: 1px solid #ddd;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background-color 0.2s;
}

.new-chat-btn:hover {
  background-color: #f0f0f0;
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.session-item {
  padding: 10px;
  margin-bottom: 5px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #333;
  transition: background-color 0.2s;
}

.session-item:hover {
  background-color: #e5e5e5;
}

.session-item.active {
  background-color: #e0e0e0;
}

.session-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}

.delete-btn {
  background: none;
  border: none;
  color: #999;
  cursor: pointer;
  font-size: 16px;
  padding: 0 5px;
  opacity: 0; /* 默认隐藏 */
  transition: opacity 0.2s;
}

.session-item:hover .delete-btn {
  opacity: 1; /* 悬停显示 */
}

.delete-btn:hover {
  color: #ff4d4f;
}

/* 主聊天区域样式调整 */
.chat-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%; 
  background: #fff;
  min-width: 0; /* 防止 flex 子项溢出 */
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

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  scroll-behavior: smooth;
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
}

.chat-footer {
  border-top: 1px solid #eaeaea;
  padding: 20px;
  background: white;
}

.clear-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 5px;
  border-radius: 4px;
  transition: background 0.2s;
}

.clear-btn:hover {
  background: #f0f0f0;
}
</style>
