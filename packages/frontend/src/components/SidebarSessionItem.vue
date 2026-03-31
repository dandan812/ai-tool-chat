<script setup lang="ts">
import { computed } from 'vue'
import { formatSessionTime } from '../utils/sidebarPresentation'

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
  <div
    class="session-item"
    :class="{ active }"
    @click="emit('select')"
  >
    <div class="session-info">
      <div class="session-meta">
        <span class="session-title">{{ title }}</span>
        <span v-if="active" class="active-chip">当前</span>
      </div>
      <span class="session-time">最近更新 {{ formattedTime }}</span>
    </div>
    <button class="delete-btn" @click.stop="emit('delete')" aria-label="删除会话">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  overflow: hidden;
}

.session-item:hover {
  background: var(--surface-strong);
  border-color: var(--border-default);
  box-shadow: var(--shadow-panel);
  transform: translateY(-1px);
}

.session-item.active {
  background: var(--surface-strong);
  border-color: rgba(201, 106, 23, 0.28);
  box-shadow: var(--shadow-panel);
}

.session-item.active::before {
  content: '';
  position: absolute;
  inset: 10px auto 10px 0;
  width: 4px;
  border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
  background: var(--accent-primary);
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.session-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.session-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.active-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-primary);
  font-size: var(--text-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.session-time {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.delete-btn {
  opacity: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.session-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--danger-soft);
  color: var(--error);
}
</style>
