<script setup lang="ts">
/**
 * 聊天头部组件 - 《反主流》美学
 *
 * 设计理念：
 * 简洁、有温度的头部设计
 *
 * 功能特性：
 * - 显示当前会话标题
 * - 显示在线状态指示
 * - 切换侧边栏按钮（移动端）
 * - 清空当前对话按钮
 *
 * @package frontend/src/components
 */

import { useChatStore } from '../stores/chat'
import { computed, ref } from 'vue'
import { Menu, Trash2, X } from '@lucide/vue'
import { getTaskModelLabel } from '../utils/taskPresentation'

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 切换侧边栏事件 */
  toggleSidebar: []
}>()

/** 聊天状态管理 */
const store = useChatStore()

const currentTask = computed(() => store.getCurrentTask(store.currentSessionId))
const currentModel = computed(() =>
  getTaskModelLabel(currentTask.value, store.getSteps(store.currentSessionId))
)

const currentStatus = computed(() => {
  if (store.isSessionLoading(store.currentSessionId)) return '执行中'
  if (currentTask.value?.status === 'failed') return '需重试'
  if (currentTask.value?.status === 'completed') return '已完成'
  if (currentTask.value?.status === 'cancelled') return '已取消'
  return '准备就绪'
})
const confirmingClear = ref(false)
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
          class="icon-button menu"
          title="打开侧栏"
          aria-label="菜单"
          @click="emit('toggleSidebar')"
        >
          <Menu />
        </button>
        <div class="title-group">
          <h1>{{ store.currentSession?.title ?? '新对话' }}</h1>
          <span class="status-indicator" :class="{ active: store.isLoading }"
            ><span class="status-dot" />{{ currentStatus }}</span
          >
        </div>
      </div>
      <div class="header-right">
        <span class="model-label">{{ currentModel }}</span>
        <template v-if="confirmingClear">
          <button class="button" @click="clearConfirmed">确认清空</button>
          <button
            class="icon-button"
            title="保留对话"
            aria-label="保留对话"
            @click="confirmingClear = false"
          >
            <X />
          </button>
        </template>
        <button
          v-else
          class="icon-button danger clear-btn"
          title="清空当前会话"
          aria-label="清空对话"
          @click="confirmingClear = true"
        >
          <Trash2 />
        </button>
      </div>
    </div>
  </header>
</template>
