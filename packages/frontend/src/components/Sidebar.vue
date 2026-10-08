<script setup lang="ts">
/**
 * 侧边栏组件
 *
 * 目标：
 * - 让侧边栏更像工作区导航，而不是单纯的列表
 * - 强化品牌、当前会话和主操作的层级
 *
 * @package frontend/src/components
 */

import { useChatStore } from '../stores/chat'
import { useTheme } from '../composables/useTheme'
import SidebarSessionItem from './SidebarSessionItem.vue'
import { SIDEBAR_THEME_OPTIONS } from '../utils/sidebarPresentation'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import { MessageSquare, Plus, Search, Sun, Moon, Folder, UserRound } from '@lucide/vue'

interface Props {
  /** 侧边栏是否展开（移动端） */
  isOpen: boolean
  resourcesOpen?: boolean
}

defineProps<Props>()
const emit = defineEmits<{ resources: [open: boolean, view?: 'tasks' | 'files' | 'usage'] }>()
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
  emit('resources', false)
}
function selectSession(id: string) {
  store.switchSession(id)
  emit('resources', false)
}
</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'is-open': isOpen }"
    :inert="mobile && !isOpen"
    aria-label="工作空间导航"
  >
    <div class="sidebar-header">
      <div class="brand">
        <span class="brand-mark"><MessageSquare /></span
        ><span class="brand-name">AI Tool Chat</span>
      </div>
      <button
        class="new-chat-btn"
        @click="createSession"
      >
        <Plus :size="16" />新对话
      </button>
    </div>
    <nav class="sidebar-nav" aria-label="工作区">
      <button :class="{ active: !resourcesOpen }" @click="emit('resources', false)">
        <MessageSquare />对话
      </button>
      <button :class="{ active: resourcesOpen }" @click="emit('resources', true)">
        <Folder />任务与文件
      </button>
    </nav>
    <label class="session-search"
      ><Search /><input v-model="query" type="search" placeholder="搜索对话" aria-label="搜索对话"
    /></label>
    <div class="session-list">
      <div class="list-header">
        <span>对话历史</span><span class="list-count">{{ store.sessions.length }}</span>
      </div>
      <SidebarSessionItem
        v-for="session in filteredSessions"
        :key="session.id"
        :title="session.title"
        :updated-at="session.updatedAt"
        :active="session.id === store.currentSessionId"
        @select="selectSession(session.id)"
        @delete="store.deleteSession(session.id)"
      />
      <p v-if="!filteredSessions.length" class="empty-history">
        {{ query ? '没有找到对话' : '暂无对话' }}
      </p>
    </div>
    <div class="sidebar-footer">
      <button class="account-link" @click="emit('resources', true, 'usage')">
        <UserRound />账户与用量
      </button>
      <div class="theme-switch" aria-label="主题">
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
  </aside>
</template>
