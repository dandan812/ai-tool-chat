<script setup lang="ts">
/**
 * 消息列表组件（Task/Step 版）
 * 展示消息、Step 进度、图片
 */
import { watch } from 'vue';
import { useChatStore } from '../stores/chat';
import { useScroll } from '../composables/useScroll';
import ChatMessage from './ChatMessage.vue';
import StepIndicator from './StepIndicator.vue';
import type { Task, Step,  } from '../types/task';

// ==================== Props ====================

interface Props {
  currentTask: Task | null;
  currentSteps: Step[];
}

defineProps<Props>();

// ==================== Store & Composables ====================

const store = useChatStore();
const { container, scrollToBottom, shouldAutoScroll } = useScroll();

// ==================== 自动滚动 ====================

watch(() => store.messages.length, scrollToBottom);

watch(
  () => store.messages[store.messages.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom();
    }
  }
);

// ==================== 快捷提问 ====================

const SUGGESTIONS = [
  '给我一个简单的 JavaScript 代码示例',
  '解释一下什么是 Vue 3',
  '帮我写一个前端简历模板',
] as const;

// ==================== 图片展示 ====================

// 该函数已废弃，后续如需展示消息图片可在此扩展
// function getMessageImages(index: number): ImageData[] {
//   // 从消息中提取图片信息（如果有的话）
//   // 这里可以根据实际需求调整
//   return [];
// }
</script>

<template>
  <main ref="container" class="chat-messages">
    <!-- Step 进度指示器 -->
    <StepIndicator
      v-if="currentTask && currentSteps.length > 0"
      :task="currentTask"
      :steps="currentSteps"
    />

    <!-- 空状态 -->
    <div v-if="store.messages.length === 0 && !currentTask" class="empty-state">
      <h2>你好！我是你的 AI 助手</h2>
      <p>有什么我可以帮助你的吗？</p>

      <div class="suggestions">
        <button
          v-for="suggestion in SUGGESTIONS"
          :key="suggestion"
          class="suggestion-btn"
          @click="store.sendMessage(suggestion)"
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

    <!-- 加载状态 -->
    <div v-if="store.isLoading && !currentTask" class="loading-state">
      <div class="loading-spinner" />
      <p>AI 正在思考...</p>
    </div>
  </main>
</template>

<style scoped>
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-color);
}

.empty-state h2 {
  font-size: 24px;
  margin-bottom: 12px;
}

.empty-state p {
  color: var(--text-secondary);
  margin-bottom: 32px;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
}

.suggestion-btn {
  padding: 12px 20px;
  font-size: 14px;
  color: var(--text-color);
  background: var(--message-ai-bg);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.suggestion-btn:hover {
  background: var(--btn-secondary-hover);
  border-color: var(--accent-color);
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
