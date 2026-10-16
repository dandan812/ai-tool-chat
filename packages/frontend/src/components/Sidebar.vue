<script setup lang="ts">
/**
 * 侧边栏组件
 *
 * 目标：
 * - 会话历史和资源导航
 *
 * @package frontend/src/components
 */

import { useChatStore } from '../stores/chat'
import { useTheme } from '../composables/useTheme'
import SidebarSessionItem from './SidebarSessionItem.vue'
import { SIDEBAR_THEME_OPTIONS } from '../utils/sidebarPresentation'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElDialog } from 'element-plus/es/components/dialog/index'
import { ElInput } from 'element-plus/es/components/input/index'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input/style/css'
import {
  MessageSquare,
  SquarePen,
  Search,
  Sun,
  Moon,
  LayoutDashboard,
  UserRound,
  PanelLeftClose,
  X
} from '@lucide/vue'

interface Props {
  /** 侧边栏是否展开（移动端） */
  isOpen: boolean
  isCollapsed?: boolean
  resourcesOpen?: boolean
  resourceView?: 'tasks' | 'files' | 'usage'
}

defineProps<Props>()
const emit = defineEmits<{
  resources: [open: boolean, view?: 'tasks' | 'files' | 'usage']
  close: []
  openChat: []
  collapse: []
}>()
const mobile = ref(false)
const media = window.matchMedia('(max-width: 768px)')
function updateMobile() {
  mobile.value = media.matches
}
onMounted(() => {
  updateMobile()
  media.addEventListener('change', updateMobile)
})
onScopeDispose(() => media.removeEventListener('change', updateMobile))

const store = useChatStore()
const { theme, setTheme } = useTheme()
const query = ref('')
const filteredSessions = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  return store.sessions.filter((session) => session.title.toLocaleLowerCase().includes(term))
})
function createSession() {
  store.createSession()
  emit('openChat')
}
function selectSession(id: string) {
  store.switchSession(id)
  emit('openChat')
}
const deletingSession = ref<string | null>(null)
const deletingTitle = computed(
  () => store.sessions.find((session) => session.id === deletingSession.value)?.title ?? ''
)
function deleteConfirmed() {
  if (deletingSession.value) store.deleteSession(deletingSession.value)
  deletingSession.value = null
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'is-open': isOpen, 'is-collapsed': isCollapsed }"
    :inert="(mobile && !isOpen) || isCollapsed"
    :role="mobile && isOpen ? 'dialog' : undefined"
    :aria-modal="mobile && isOpen ? true : undefined"
    aria-label="会话导航"
  >
    <div class="sidebar-header">
      <div class="brand">
        <span class="brand-mark"><MessageSquare /></span
        ><span class="brand-name">AI Tool Chat</span>
        <button
          class="icon-button sidebar-collapse"
          aria-label="收起侧栏"
          title="收起侧栏"
          @click="emit('collapse')"
        >
          <PanelLeftClose />
        </button>
        <button
          class="icon-button sidebar-close"
          aria-label="关闭会话导航"
          title="关闭会话导航"
          @click="emit('close')"
        >
          <X />
        </button>
      </div>
      <button class="sidebar-nav-button new-chat-btn" @click="createSession">
        <SquarePen />新对话
      </button>
    </div>
    <nav class="sidebar-nav" aria-label="工作空间">
      <span class="nav-section-label">工作空间</span>
      <button
        class="sidebar-nav-button"
        :class="{ active: !resourcesOpen }"
        :aria-current="!resourcesOpen ? 'page' : undefined"
        @click="emit('openChat')"
      >
        <MessageSquare /><span>对话</span>
      </button>
      <button
        class="sidebar-nav-button"
        :class="{ active: resourcesOpen }"
        :aria-current="resourcesOpen ? 'page' : undefined"
        @click="emit('resources', true, resourceView ?? 'tasks')"
      >
        <LayoutDashboard /><span>工作台</span>
      </button>
    </nav>
    <ElInput
      v-model="query"
      class="session-search"
      clearable
      placeholder="搜索对话"
      aria-label="搜索对话"
    >
      <template #prefix><Search /></template>
    </ElInput>
    <div class="session-list">
      <div class="list-header">
        <span>最近对话</span><span>{{ filteredSessions.length }}</span>
      </div>
      <SidebarSessionItem
        v-for="session in filteredSessions"
        :key="session.id"
        :title="session.title"
        :updated-at="session.updatedAt"
        :active="!resourcesOpen && session.id === store.currentSessionId"
        @select="selectSession(session.id)"
        @delete="deletingSession = session.id"
      />
      <p v-if="!filteredSessions.length" class="empty-history">
        {{ query ? '没有找到对话' : '暂无对话' }}
      </p>
    </div>
    <div class="sidebar-footer">
      <button class="button account-link" @click="emit('resources', true, 'usage')">
        <span class="account-avatar"><UserRound /></span><span>账户与用量</span>
      </button>
      <div class="theme-switch" aria-label="主题">
        <span>外观</span>
        <div class="theme-options">
          <button
            v-for="option in SIDEBAR_THEME_OPTIONS"
            :key="option.value"
            class="icon-button"
            :title="option.label"
            :aria-label="option.label"
            :aria-pressed="theme === option.value"
            @click="setTheme(option.value)"
          >
            <Sun v-if="option.value === 'light'" /><Moon v-else />
          </button>
        </div>
      </div>
    </div>
  </aside>
  <ElDialog
    :model-value="deletingSession !== null"
    title="删除会话"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="!$event && (deletingSession = null)"
  >
    <p class="dialog-description">确定删除「{{ deletingTitle }}」及其本地消息记录？</p>
    <template #footer>
      <ElButton @click="deletingSession = null">保留会话</ElButton>
      <ElButton type="danger" @click="deleteConfirmed">删除会话</ElButton>
    </template>
  </ElDialog>
</template>
