<script setup lang="ts">
// Page layout and input events; session persistence and task observation live in the store.
import { nextTick, onMounted, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { ImageData, UploadedFileRef } from '../types/task'

import Sidebar from '../components/Sidebar.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import StepIndicator from '../components/StepIndicator.vue'
import Toast from '../components/Toast.vue'
import ErrorBoundary from '../components/ErrorBoundary.vue'

const store = useChatStore()
onMounted(() => {
  void store.restoreActiveTask()
})

const isSidebarOpen = ref(false)
const isWorkspaceOpen = ref(false)
const workspaceView = ref<'tasks' | 'files' | 'usage'>('tasks')
let sidebarTrigger: HTMLElement | null = null
watch(isSidebarOpen, async (open) => {
  if (open) sidebarTrigger = document.activeElement as HTMLElement | null
  await nextTick()
  if (open) document.querySelector<HTMLElement>('.sidebar button')?.focus()
  else sidebarTrigger?.focus()
})

function openWorkspace(open: boolean, view: 'tasks' | 'files' | 'usage' = 'tasks') {
  isWorkspaceOpen.value = open
  workspaceView.value = view
  isSidebarOpen.value = false
}

function handleSidebarKeyboard(event: KeyboardEvent) {
  if (!isSidebarOpen.value) return
  if (event.key === 'Escape') {
    closeSidebar()
    return
  }
  if (event.key !== 'Tab') return
  const elements = [
    ...document.querySelectorAll<HTMLElement>('.sidebar button:not(:disabled), .sidebar input')
  ]
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

// Switching focus does not cancel background execution or another session's observer.
watch(
  () => store.currentSessionId,
  () => {
    store.clearStreamingContent()
    isSidebarOpen.value = false
  }
)

function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value
}

function closeSidebar() {
  isSidebarOpen.value = false
}

async function handleSend(
  content: string,
  images: ImageData[] = [],
  files: UploadedFileRef[] = []
) {
  await store.sendTaskMessage(content, images, files)
}

// Explicit backend cancellation; a failed cancellation keeps observation active.
function handleStop() {
  store.stopGeneration()
}
</script>

<template>
  <div class="app-layout" @keydown="handleSidebarKeyboard">
    <button
      v-if="isSidebarOpen"
      class="sidebar-overlay"
      aria-label="关闭侧栏"
      @click="closeSidebar"
    />
    <ErrorBoundary title="会话列表不可用" message="请重新打开页面。">
      <Sidebar
        :is-open="isSidebarOpen"
        :resources-open="isWorkspaceOpen"
        @resources="openWorkspace"
      />
    </ErrorBoundary>
    <div class="chat-layout">
      <div class="chat-stage">
        <ChatHeader @toggle-sidebar="toggleSidebar" />
        <WorkspacePanel
          :open="isWorkspaceOpen"
          :view="workspaceView"
          :viewing="store.isLoading"
          @update-open="isWorkspaceOpen = $event"
          @open-task="store.restoreTask"
          @stop-viewing="store.stopViewing"
        />
        <div class="chat-stream">
          <ErrorBoundary title="消息暂时不可用" message="请重新打开会话。">
            <ChatMessages @send="handleSend" />
          </ErrorBoundary>
        </div>
        <footer class="chat-footer">
          <div class="composer-shell">
            <ErrorBoundary title="输入暂时不可用" message="请重新打开会话。">
              <StepIndicator
                :task="store.getCurrentTask(store.currentSessionId)"
                :steps="store.getSteps(store.currentSessionId)"
              />
              <ChatInput
                :key="store.currentSessionId"
                :session-id="store.currentSessionId"
                :loading="store.isSessionLoading(store.currentSessionId)"
                @send="handleSend"
                @stop="handleStop"
              />
            </ErrorBoundary>
            <p class="composer-note">AI 回答可能有误，请核对重要信息</p>
          </div>
        </footer>
      </div>
    </div>
    <Toast
      :show="!!store.storageError"
      :message="store.storageError ?? ''"
      type="warning"
      @close="store.storageError = null"
    />
  </div>
</template>
