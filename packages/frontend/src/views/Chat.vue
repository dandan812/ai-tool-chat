<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import ChatMessage from '../components/ChatMessage.vue'
import ChatInput from '../components/ChatInput.vue'
import { nextTick, ref, watch, onMounted } from 'vue'

// 初始化 Pinia Store
const store = useChatStore()

// 控制系统提示词面板显示
const showSystemPrompt = ref(false)
const systemPromptInput = ref('')

// --- 主题管理 (Dark Mode) ---
const theme = ref<'light' | 'dark'>('light')

const toggleTheme = () => {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('chat_theme', theme.value)
}

// 初始化主题
onMounted(() => {
  const savedTheme = localStorage.getItem('chat_theme') as 'light' | 'dark' | null
  if (savedTheme) {
    theme.value = savedTheme
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    theme.value = 'dark'
  }
  document.documentElement.setAttribute('data-theme', theme.value)
})

// --- 移动端适配 (Sidebar Drawer) ---
const isSidebarOpen = ref(false)
const toggleSidebar = () => {
  isSidebarOpen.value = !isSidebarOpen.value
}

// 当切换会话时，如果是移动端，自动关闭侧边栏
watch(() => store.currentSessionId, () => {
  systemPromptInput.value = store.currentSession?.systemPrompt || ''
  if (window.innerWidth <= 768) {
    isSidebarOpen.value = false
  }
}, { immediate: true })

const saveSystemPrompt = () => {
  if (store.currentSessionId) {
    store.updateSystemPrompt(store.currentSessionId, systemPromptInput.value)
    showSystemPrompt.value = false
    alert('人设设置成功！下次发送消息时生效。')
  }
}

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
  (newContent) => {
    // 只有当用户没有向上滚动查看历史消息时，才自动滚动到底部
    // 判断逻辑：如果距离底部小于 100px，则认为用户在底部，可以自动滚动
    if (messagesContainer.value) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100
      
      if (isAtBottom) {
        scrollToBottom()
      }
    }
  },
  { deep: true } // 深度监听，确保对象属性变化也能触发
)
</script>

<template>
  <div class="app-layout">
    <!-- 移动端遮罩层 -->
    <div 
      v-if="isSidebarOpen" 
      class="sidebar-overlay" 
      @click="isSidebarOpen = false"
    ></div>

    <!-- 侧边栏：会话列表 -->
    <aside class="sidebar" :class="{ 'sidebar-open': isSidebarOpen }">
      <div class="sidebar-header">
        <button class="new-chat-btn" @click="store.createSession()">
          + 新建对话
        </button>
      </div>

      <!-- 系统提示词设置 -->
      <div class="system-prompt-section">
        <button class="prompt-toggle-btn" @click="showSystemPrompt = !showSystemPrompt">
          {{ showSystemPrompt ? '收起人设设置' : '⚙️ 设置助手人设' }}
        </button>
        <div v-if="showSystemPrompt" class="prompt-editor">
          <textarea 
            v-model="systemPromptInput" 
            placeholder="例如：你是一个资深的程序员，说话简洁专业..."
          ></textarea>
          <button @click="saveSystemPrompt" class="save-prompt-btn">保存设置</button>
        </div>
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

      <!-- 侧边栏底部：主题切换 -->
      <div class="sidebar-footer">
        <button class="theme-toggle-btn" @click="toggleTheme">
          {{ theme === 'light' ? '🌙 深色模式' : '☀️ 浅色模式' }}
        </button>
      </div>
    </aside>

    <!-- 主聊天区域 -->
    <div class="chat-layout">
      <!-- 顶部标题栏 -->
      <header class="chat-header">
        <div class="header-left">
          <button class="menu-btn" @click="toggleSidebar">☰</button>
          <h1>{{ store.currentSession?.title || 'AI 助手' }}</h1>
        </div>
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
          :index="index"
          :role="msg.role"
          :content="msg.content"
          @delete="store.deleteMessage"
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
  background-color: var(--sidebar-bg);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  transition: transform 0.3s ease, background-color 0.3s;
  z-index: 100;
}

.sidebar-header {
  padding: 10px;
}

.system-prompt-section {
  padding: 10px;
  border-bottom: 1px solid var(--border-color);
}

.prompt-toggle-btn {
  width: 100%;
  padding: 6px;
  background: var(--btn-secondary-bg);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
}

.prompt-editor {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-editor textarea {
  width: 100%;
  height: 80px;
  padding: 8px;
  background: var(--input-bg);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 12px;
  resize: none;
}

.save-prompt-btn {
  padding: 4px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.new-chat-btn {
  width: 100%;
  padding: 10px;
  background-color: var(--bg-color);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  cursor: pointer;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: all 0.2s;
}

.new-chat-btn:hover {
  background-color: var(--btn-secondary-hover);
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
  color: var(--text-color);
  transition: background-color 0.2s;
}

.session-item:hover {
  background-color: var(--btn-secondary-hover);
}

.session-item.active {
  background-color: var(--active-session-bg);
}

.sidebar-footer {
  padding: 15px;
  border-top: 1px solid var(--border-color);
}

.theme-toggle-btn {
  width: 100%;
  padding: 8px;
  background: var(--btn-secondary-bg);
  border: 1px solid var(--border-color);
  color: var(--text-color);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
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
  color: var(--text-secondary);
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
  background: var(--bg-color);
  min-width: 0; /* 防止 flex 子项溢出 */
  transition: background-color 0.3s;
}

.chat-header {
  height: 60px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: var(--bg-color);
  z-index: 10;
  transition: background-color 0.3s;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 15px;
}

.menu-btn {
  display: none; /* 默认隐藏，仅移动端显示 */
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-color);
  cursor: pointer;
}

.chat-header h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-color);
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden; /* 防止水平滚动 */
  padding: 20px;
  scroll-behavior: smooth;
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}

.chat-footer {
  border-top: 1px solid var(--border-color);
  padding: 20px;
  background: var(--bg-color);
}

.clear-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 1.2rem;
  padding: 5px;
  border-radius: 4px;
  transition: background 0.2s;
}

.clear-btn:hover {
  background: var(--btn-secondary-hover);
}

/* 移动端适配样式 */
@media (max-width: 768px) {
  .menu-btn {
    display: block;
  }

  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    transform: translateX(-100%);
  }

  .sidebar-open {
    transform: translateX(0);
  }

  .sidebar-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 90;
  }

  .chat-header {
    padding: 0 15px;
  }

  .chat-messages {
    padding: 15px;
  }

  .chat-footer {
    padding: 10px;
  }
}
</style>
