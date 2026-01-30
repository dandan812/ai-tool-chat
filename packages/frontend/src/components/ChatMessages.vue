<script setup lang="ts">
/**
 * 聊天消息列表组件
 * 功能：渲染消息列表、处理自动滚动、显示空状态和加载状态
 */
import { useChatStore } from '../stores/chat'
import ChatMessage from './ChatMessage.vue'
import { watch } from 'vue'
import { useScroll } from '../composables/useScroll'

// ==================== Store & Composable ====================

/** 初始化 Pinia Store，管理聊天消息状态 */
const store = useChatStore()

/**
 * 使用滚动 composable
 * - scrollToBottom: 滚动到底部的方法
 * - shouldAutoScroll: 判断是否应该自动滚动（用户未向上滚动查看历史）
 */
const { scrollToBottom, shouldAutoScroll } = useScroll()

// ==================== 自动滚动监听 ====================

/**
 * 监听消息列表长度变化
 * 触发场景：用户发送新消息、开始新对话时
 * 作用：自动滚动到底部，显示最新消息
 */
watch(() => store.messages.length, scrollToBottom)

/**
 * 监听最后一条消息的内容变化
 * 触发场景：AI 流式输出（打字机效果）时，内容不断更新
 * 作用：实时跟随滚动，让用户看到最新的输出内容
 *
 * 注意：只有当用户没有向上滚动查看历史消息时，才自动滚动
 * 避免打断用户浏览历史消息的体验
 */
watch(
  () => store.messages[store.messages.length - 1]?.content,
  () => {
    // 用户未手动向上滚动时，才自动跟随滚动
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  },
  { deep: true } // 深度监听对象属性变化
)
</script>

<template>
  <!-- 消息列表容器 -->
  <main class="chat-messages" ref="messagesContainer">
    <!-- 空状态提示：当没有消息时显示欢迎界面 -->
    <div v-if="store.messages.length === 0" class="empty-state">
      <h2>你好！我是你的 AI 助手</h2>
      <p>有什么我可以帮助你的吗？</p>
      <!-- 快捷建议按钮：点击后自动发送预设问题 -->
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

    <!-- 消息列表渲染：遍历 store.messages 渲染每条消息 -->
    <ChatMessage
      v-for="(msg, index) in store.messages"
      v-bind:key="index"
      :index="index"
      :role="msg.role"
      :content="msg.content"
      @delete="store.deleteMessage"
    />

    <!-- 加载状态：AI 正在生成回复时显示 -->
    <div v-if="store.isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>AI 正在思考...</p>
    </div>
  </main>
</template>
