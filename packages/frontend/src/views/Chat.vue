<script setup lang="ts">
// Page layout and input events; session persistence and task observation live in the store.
import { computed, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { ImageData, UploadedFileRef } from '../types/task'

import Sidebar from '../components/Sidebar.vue'
import WorkspacePanel from '../components/WorkspacePanel.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import ChatWelcome from '../components/ChatWelcome.vue'
import StepIndicator from '../components/StepIndicator.vue'
import Toast from '../components/Toast.vue'
import ErrorBoundary from '../components/ErrorBoundary.vue'

const store = useChatStore()
const chatInput = ref<InstanceType<typeof ChatInput> | null>(null)
onMounted(() => {
  void store.restoreActiveTask()
})

const isSidebarOpen = ref(false)
const desktopSidebarOpen = ref(true)
const mobileMedia = window.matchMedia('(max-width: 768px)')
const isMobile = ref(mobileMedia.matches)
const sidebarVisible = computed(() =>
  isMobile.value ? isSidebarOpen.value : desktopSidebarOpen.value
)
const isNewChat = computed(() => !store.messages.length)
const isWorkspaceOpen = ref(false)
const workspaceView = ref<'tasks' | 'files' | 'usage'>('tasks')
const resourcePage = ref<HTMLElement | null>(null)
let resourceTrigger: HTMLElement | null = null
watch(isWorkspaceOpen, async (open) => {
  await nextTick()
  if (open) {
    resourcePage.value?.querySelector<HTMLElement>('h2')?.focus()
  } else if (
    resourceTrigger?.isConnected &&
    !resourceTrigger.closest('details:not([open])') &&
    !(resourceTrigger.closest('.sidebar') && !sidebarVisible.value)
  ) {
    resourceTrigger.focus()
  } else {
    document.querySelector<HTMLElement>('.message-input:not(:disabled)')?.focus()
  }
})
function updateLayout() {
  isMobile.value = mobileMedia.matches
  isSidebarOpen.value = false
}
onMounted(() => mobileMedia.addEventListener('change', updateLayout))
onScopeDispose(() => mobileMedia.removeEventListener('change', updateLayout))
let sidebarTrigger: HTMLElement | null = null
watch(isSidebarOpen, async (open) => {
  if (open) sidebarTrigger = document.activeElement as HTMLElement | null
  await nextTick()
  if (open)
    Array.from(document.querySelectorAll<HTMLElement>('.sidebar button'))
      .find((element) => element.offsetParent !== null)
      ?.focus()
  else if (!resourcePage.value?.contains(document.activeElement)) sidebarTrigger?.focus()
})
watch(desktopSidebarOpen, async (open) => {
  await nextTick()
  document.querySelector<HTMLElement>(open ? '.sidebar-collapse' : '.header .menu')?.focus()
})

function openWorkspace(open: boolean, view: 'tasks' | 'files' | 'usage' = 'tasks') {
  if (open && !isWorkspaceOpen.value) resourceTrigger = document.activeElement as HTMLElement | null
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
    ...document.querySelectorAll<HTMLElement>(
      '.sidebar button:not(:disabled), .sidebar input, .sidebar [tabindex="0"]'
    )
  ].filter((element) => element.offsetParent !== null)
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
    isWorkspaceOpen.value = false
  }
)

function toggleSidebar() {
  if (isMobile.value) isSidebarOpen.value = !isSidebarOpen.value
  else desktopSidebarOpen.value = !desktopSidebarOpen.value
}

function closeSidebar() {
  isSidebarOpen.value = false
}
function returnToChat() {
  isSidebarOpen.value = false
  isWorkspaceOpen.value = false
}

async function handleSend(
  content: string,
  images: ImageData[] = [],
  files: UploadedFileRef[] = [],
  enableTools = false
) {
  if (enableTools) await store.sendTaskMessage(content, images, files, true)
  else await store.sendTaskMessage(content, images, files)
}
function handleOpenTask(taskId: string) {
  isWorkspaceOpen.value = false
  void store.restoreTask(taskId)
}

// Explicit backend cancellation; a failed cancellation keeps observation active.
function handleStop() {
  store.stopGeneration()
}
</script>

<template>
  <div
    class="app-layout"
    :class="{ 'sidebar-collapsed': !isMobile && !desktopSidebarOpen }"
    @keydown="handleSidebarKeyboard"
  >
    <button
      v-if="isSidebarOpen"
      class="sidebar-overlay"
      aria-label="关闭侧栏"
      @click="closeSidebar"
    />
    <ErrorBoundary title="会话列表不可用" message="请重新打开页面。">
      <Sidebar
        :is-open="isSidebarOpen"
        :is-collapsed="!isMobile && !desktopSidebarOpen"
        :resources-open="isWorkspaceOpen"
        :resource-view="workspaceView"
        @resources="openWorkspace"
        @close="closeSidebar"
        @open-chat="returnToChat"
        @collapse="toggleSidebar"
      />
    </ErrorBoundary>
    <div class="chat-layout" :inert="isSidebarOpen">
      <ChatHeader
        :sidebar-open="sidebarVisible"
        :mobile="isMobile"
        :resources-open="isWorkspaceOpen"
        :resource-view="workspaceView"
        @toggle-sidebar="toggleSidebar"
        @open-resources="openWorkspace(true, $event)"
        @open-chat="returnToChat"
      />
      <div class="chat-workspace">
        <main v-if="isWorkspaceOpen" ref="resourcePage" class="resource-page" aria-label="工作空间">
          <ErrorBoundary title="资源暂时不可用">
            <WorkspacePanel
              :open="isWorkspaceOpen"
              :view="workspaceView"
              :viewing="store.isLoading"
              @update-open="isWorkspaceOpen = $event"
              @open-task="handleOpenTask"
              @update-view="workspaceView = $event"
              @stop-viewing="store.stopViewing"
            />
          </ErrorBoundary>
        </main>
        <main
          v-show="!isWorkspaceOpen"
          class="chat-stage"
          :class="{ 'is-new-chat': isNewChat }"
          aria-label="对话"
        >
          <div v-show="!isNewChat" class="chat-stream">
            <ErrorBoundary title="消息暂时不可用" message="请重新打开会话。">
              <ChatMessages />
            </ErrorBoundary>
          </div>
          <footer class="chat-footer">
            <div class="composer-shell">
              <ErrorBoundary title="输入暂时不可用" message="请重新打开会话。">
                <ChatWelcome v-if="isNewChat" @prompt="chatInput?.insertPrompt($event)" />
                <StepIndicator
                  v-if="
                    store.getCurrentTask(store.currentSessionId)?.status !== 'completed' ||
                    store.getCurrentTask(store.currentSessionId)?.metadata?.toolingMode === 'active'
                  "
                  :task="store.getCurrentTask(store.currentSessionId)"
                  :steps="store.getSteps(store.currentSessionId)"
                />
                <ChatInput
                  ref="chatInput"
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
        </main>
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
