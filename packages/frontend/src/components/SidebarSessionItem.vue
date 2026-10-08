<script setup lang="ts">
import { computed } from 'vue'
import { formatSessionTime } from '../utils/sidebarPresentation'
import { Trash2 } from '@lucide/vue'

interface Props {
  /** 会话标题 */
  title: string
  /** 最后更新时间 */
  updatedAt: number
  /** 是否为当前会话 */
  active: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 选中当前会话 */
  select: []
  /** 删除当前会话 */
  delete: []
}>()

const formattedTime = computed(() => formatSessionTime(props.updatedAt))
</script>

<template>
  <div class="session-item" :class="{ active }">
    <button
      class="session-select"
      :aria-current="active ? 'true' : undefined"
      @click="emit('select')"
    >
      <span class="session-title">{{ title }}</span
      ><span class="session-time">{{ formattedTime }}</span>
    </button>
    <button
      class="icon-button danger delete-btn"
      title="删除会话"
      aria-label="删除会话"
      @click="emit('delete')"
    >
      <Trash2 />
    </button>
  </div>
</template>
