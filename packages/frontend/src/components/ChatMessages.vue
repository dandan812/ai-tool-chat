<script setup lang="ts">
/**
 * 消息列表组件（Task/Step 版）
 * 展示消息、图片
 */
import { watch, ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'
import type { Task, Step } from '../types/task'

// ==================== Props & Emits ====================

interface Props {
  currentTask: Task | null
  currentSteps: Step[]
}

defineProps<Props>()

const emit = defineEmits<{
  send: [content: string]
}>()

// ==================== Store & Composables ====================

const store = useChatStore()
const { container, scrollToBottom, shouldAutoScroll } = useScroll()

// ==================== 自动滚动 ====================

watch(() => store.messages.length, scrollToBottom)

watch(
  () => store.messages[store.messages.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

// ==================== 热门提问（随机生成）====================

const allSuggestions = [
  // 编程开发
  '给我一个简单的 JavaScript 代码示例',
  '解释一下什么是 Vue 3',
  'React 和 Vue 有什么区别？',
  '如何学习 TypeScript？',
  '写一个 Python 爬虫示例',
  '解释一下什么是闭包',
  '前端性能优化有哪些方法？',
  '什么是响应式编程？',
  // AI 技术
  'GPT 和 DeepSeek 有什么区别？',
  '如何写好 Prompt？',
  '解释一下大语言模型原理',
  'AI 会取代程序员吗？',
  // 实用工具
  '帮我写一个前端简历模板',
  '生成一个待办事项清单',
  '写一封求职邮件',
  '帮我制定一周健身计划',
  // 知识科普
  '解释一下量子计算',
  '什么是区块链？',
  '如何投资股票？',
  '推荐几本好书',
  // 创意写作
  '写一个科幻故事开头',
  '帮我写一首诗',
  '生成 10 个创业点子',
  '写一段产品文案'
]

// 当前显示的提问
const suggestions = ref<string[]>([])

// 随机选择 3 个提问
function generateSuggestions() {
  const shuffled = [...allSuggestions].sort(() => 0.5 - Math.random())
  suggestions.value = shuffled.slice(0, 3)
}

// 初始化
generateSuggestions()

// 监听会话切换，重新生成提问
watch(
  () => store.currentSessionId,
  () => {
    generateSuggestions()
  }
)

function handleSuggestionClick(suggestion: string) {
  emit('send', suggestion)
}
</script>

<template>
  <main ref="container" class="chat-messages">
    <!-- 空状态 -->
    <div v-if="store.messages.length === 0 && !currentTask" class="empty-state">
      <h2>你好！我是你的 AI 助手</h2>
      <p>有什么我可以帮助你的吗？</p>

      <div class="suggestions">
        <button
          v-for="suggestion in suggestions"
          :key="suggestion"
          class="suggestion-btn"
          @click="handleSuggestionClick(suggestion)"
        >
          {{ suggestion }}
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <ChatMessage
      v-for="(msg, index) in store.messages"
      :key="`${index}-${msg.role}`"
      :index="index"
      :role="msg.role"
      :content="msg.content"
      @delete="store.deleteMessage"
    />
  </main>
</template>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  text-align: center;
  color: var(--text-color);
}

.empty-state h2 {
  font-size: 28px;
  font-weight: 600;
  margin-bottom: 12px;
}

.empty-state p {
  font-size: 16px;
  color: var(--text-secondary);
  margin-bottom: 40px;
}

.suggestions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 480px;
}

.suggestion-btn {
  width: 100%;
  padding: 14px 24px;
  font-size: 15px;
  color: var(--text-color);
  background: var(--message-ai-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.suggestion-btn:hover {
  background: var(--btn-secondary-hover);
  border-color: var(--accent-color);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px;
  color: var(--text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
