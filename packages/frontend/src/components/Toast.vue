<script setup lang="ts">
/**
 * Toast 通知组件
 *
 * 显示临时通知消息，用于错误提示、成功反馈等
 *
 * @package frontend/src/components
 */

import { ref, watch } from 'vue'

/**
 * 组件属性
 */
interface Props {
  /** 是否显示通知 */
  show?: boolean
  /** 消息内容 */
  message?: string
  /** 通知类型 */
  type?: 'error' | 'success' | 'info' | 'warning'
  /** 自动关闭时间（毫秒），0 表示不自动关闭 */
  duration?: number
}

const props = withDefaults(defineProps<Props>(), {
  show: false,
  message: '',
  type: 'info',
  duration: 5000
})

const emit = defineEmits<{
  close: []
}>()

/** 是否可见 */
const visible = ref(props.show)
/** 计时器 */
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * 关闭通知
 */
function close() {
  visible.value = false
  emit('close')
}

/**
 * 监听 show 变化
 */
watch(
  () => props.show,
  (newVal) => {
    visible.value = newVal
    if (newVal && props.duration > 0) {
      // 清除之前的定时器
      if (timer) {
        clearTimeout(timer)
      }
      // 设置自动关闭
      timer = setTimeout(() => {
        close()
      }, props.duration)
    }
  }
)

/**
 * 组件卸载时清除定时器
 */
watch(visible, (newVal) => {
  if (!newVal && timer) {
    clearTimeout(timer)
    timer = null
  }
})
</script>

<template>
  <Transition name="toast">
    <div v-if="visible" class="toast" :class="[type]">
      <div class="toast-icon">
        <svg v-if="type === 'error'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <svg v-else-if="type === 'success'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <svg v-else-if="type === 'warning'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
      </div>
      <div class="toast-content">
        <span class="toast-message">{{ message }}</span>
      </div>
      <button class="toast-close" @click="close" aria-label="关闭">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  z-index: 1000;
  max-width: 400px;
  min-width: 300px;
}

/* 错误类型 */
.toast.error {
  border-color: var(--error);
}

.toast.error .toast-icon {
  color: var(--error);
}

/* 成功类型 */
.toast.success {
  border-color: var(--success);
}

.toast.success .toast-icon {
  color: var(--success);
}

/* 警告类型 */
.toast.warning {
  border-color: var(--warning);
}

.toast.warning .toast-icon {
  color: var(--warning);
}

/* 信息类型 */
.toast.info .toast-icon {
  color: var(--info);
}

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-message {
  display: block;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.5;
  word-break: break-word;
}

.toast-close {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.toast-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

/* 动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all var(--transition-base);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(32px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(32px);
}

/* 响应式 */
@media (max-width: 768px) {
  .toast {
    top: 16px;
    right: 16px;
    left: 16px;
    max-width: none;
  }
}
</style>
