<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import { computed, ref } from 'vue'
import { PanelLeftOpen, Trash2, Folder, ListTodo, SquarePen, Ellipsis } from '@lucide/vue'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElDialog } from 'element-plus/es/components/dialog/index'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/dialog/style/css'
import { getTaskModelLabel } from '../utils/taskPresentation'
import { useDetailsMenu } from '../composables/useDetailsMenu'

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 切换侧边栏事件 */
  toggleSidebar: []
  openResources: [view: 'tasks' | 'files' | 'usage']
  openChat: []
}>()
defineProps<{
  sidebarOpen: boolean
  mobile: boolean
  resourcesOpen?: boolean
  resourceView?: 'tasks' | 'files' | 'usage'
}>()

/** 聊天状态管理 */
const store = useChatStore()

const currentTask = computed(() => store.getCurrentTask(store.currentSessionId))
const currentModel = computed(() =>
  getTaskModelLabel(currentTask.value, store.getSteps(store.currentSessionId))
)

const confirmingClear = ref(false)
const { menu: actionMenu, close: closeActions, keydown: actionKeydown } = useDetailsMenu()
function openResource(view: 'tasks' | 'files') {
  closeActions(true)
  emit('openResources', view)
}
function requestClear() {
  closeActions(true)
  confirmingClear.value = true
}
function newChat() {
  closeActions(true)
  store.createSession()
  emit('openChat')
}
function clearConfirmed() {
  store.clearChat()
  confirmingClear.value = false
}
</script>

<template>
  <header class="header">
    <div class="header-content">
      <div class="header-left">
        <button
          v-if="!sidebarOpen || mobile"
          class="icon-button menu"
          title="打开侧栏"
          aria-label="打开侧栏"
          @click="emit('toggleSidebar')"
        >
          <PanelLeftOpen />
        </button>
        <div class="title-group">
          <span v-if="resourcesOpen" class="header-context"
            >工作空间<span aria-hidden="true">/</span></span
          >
          <h1>
            {{
              resourcesOpen
                ? { tasks: '任务记录', files: '文件库', usage: '账户与用量' }[
                    resourceView ?? 'tasks'
                  ]
                : '对话工作台'
            }}
          </h1>
        </div>
      </div>
      <div class="header-right">
        <span v-if="currentTask" class="model-label">{{ currentModel }}</span>
        <details ref="actionMenu" class="header-menu" @keydown="actionKeydown">
          <summary class="icon-button" aria-label="更多操作" title="更多操作"><Ellipsis /></summary>
          <div class="header-menu-items">
            <button
              class="icon-button resource-toggle"
              title="文件"
              aria-label="打开文件"
              :aria-pressed="resourcesOpen && resourceView === 'files'"
              @click="openResource('files')"
            >
              <Folder /><span>文件库</span>
            </button>
            <button
              class="icon-button resource-toggle"
              title="任务记录"
              aria-label="打开任务记录"
              :aria-pressed="resourcesOpen && resourceView === 'tasks'"
              @click="openResource('tasks')"
            >
              <ListTodo /><span>任务记录</span>
            </button>
            <button
              v-if="mobile || !sidebarOpen"
              class="icon-button"
              title="新对话"
              aria-label="新对话"
              @click="newChat"
            >
              <SquarePen /><span>新对话</span>
            </button>
            <button
              v-if="store.messages.length"
              class="icon-button danger clear-btn"
              title="清空当前会话"
              aria-label="清空对话"
              :disabled="!store.messages.length || store.isLoading"
              @click="requestClear"
            >
              <Trash2 /><span>清空对话</span>
            </button>
          </div>
        </details>
      </div>
    </div>
  </header>
  <ElDialog v-model="confirmingClear" title="清空当前对话" :close-on-click-modal="false">
    <p class="dialog-description">确定清空当前会话中的所有消息？</p>
    <template #footer>
      <ElButton @click="confirmingClear = false">保留对话</ElButton>
      <ElButton type="danger" :disabled="store.isLoading" @click="clearConfirmed"
        >确认清空</ElButton
      >
    </template>
  </ElDialog>
</template>
