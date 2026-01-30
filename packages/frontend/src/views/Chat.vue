<script setup lang="ts">
/**
 * 聊天主页面（Task/Step 版）
 * 整合侧边栏、消息列表、Step 进度、多模态输入
 */
import { ref } from 'vue';
import { useChatStore } from '../stores/chat';
import { sendTaskRequest } from '../api/task';
import type { Task, Step, ImageData } from '../types/task';
import Sidebar from '../components/Sidebar.vue';
import ChatHeader from '../components/ChatHeader.vue';
import ChatMessages from '../components/ChatMessages.vue';
import ChatInput from '../components/ChatInput.vue';
import './Chat.css';

const store = useChatStore();
const isSidebarOpen = ref(false);

// Task/Step 状态
const currentTask = ref<Task | null>(null);
const currentSteps = ref<Step[]>([]);
const abortController = ref<AbortController | null>(null);

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value;
}

function closeSidebar() {
  isSidebarOpen.value = false;
}

/**
 * 发送消息（支持多模态）
 */
async function handleSend(content: string, images: ImageData[]) {
  if (store.isLoading) return;

  // 添加用户消息
  store.addMessage(store.currentSessionId!, {
    role: 'user',
    content: content || (images.length > 0 ? '[图片]' : ''),
  });

  // 准备 AI 回复位置
  const assistantIndex = store.messages.length;
  store.messages.push({ role: 'assistant', content: '' });

  store.isLoading = true;
  abortController.value = new AbortController();

  // 重置 Task/Step 状态
  currentTask.value = null;
  currentSteps.value = [];

  try {
    await sendTaskRequest(
      {
        messages: store.messages.slice(0, -1).map(m => ({
          role: m.role,
          content: m.content,
        })),
        images: images.length > 0 ? images : undefined,
        temperature: 0.7,
      },
      {
        onTaskStart: (task) => {
          currentTask.value = task;
        },
        onTaskUpdate: (task) => {
          currentTask.value = task;
        },
        onStepStart: (step) => {
          currentSteps.value.push(step);
        },
        onStepComplete: (step) => {
          const index = currentSteps.value.findIndex(s => s.id === step.id);
          if (index !== -1) {
            currentSteps.value[index] = step;
          }
        },
        onContent: (content) => {
          if (store.messages[assistantIndex]) {
            store.messages[assistantIndex].content += content;
          }
        },
        onError: (error) => {
          console.error('Task error:', error);
          if (store.messages[assistantIndex]) {
            store.messages[assistantIndex].content += '\n\n[错误: ' + error + ']';
          }
        },
        onComplete: (task) => {
          currentTask.value = task;
          store.isLoading = false;
          abortController.value = null;
        },
      },
      abortController.value.signal
    );
  } catch (error) {
    console.error(error);
    store.isLoading = false;
    abortController.value = null;
  }
}

/**
 * 停止生成
 */
function handleStop() {
  if (abortController.value) {
    abortController.value.abort();
    abortController.value = null;
    store.isLoading = false;
  }
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

      <ChatMessages :current-task="currentTask" :current-steps="currentSteps" />

      <footer class="chat-footer">
        <ChatInput :loading="store.isLoading" @send="handleSend" @stop="handleStop" />
      </footer>
    </div>
  </div>
</template>
