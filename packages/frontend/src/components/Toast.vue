<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { CircleAlert, Check, TriangleAlert, Info, X } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    show?: boolean
    message?: string
    type?: 'error' | 'success' | 'info' | 'warning'
    duration?: number
  }>(),
  { show: false, message: '', type: 'info', duration: 5000 }
)
const emit = defineEmits<{ close: [] }>()
const visible = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

function close() {
  visible.value = false
  emit('close')
}
watch(
  () => props.show,
  (show) => {
    clearTimeout(timer)
    visible.value = show
    if (show && props.duration > 0) timer = setTimeout(close, props.duration)
  },
  { immediate: true }
)
onScopeDispose(() => clearTimeout(timer))
</script>

<template>
  <Transition name="toast">
    <div v-if="visible" class="toast" :class="type" role="status">
      <span class="toast-icon">
        <CircleAlert v-if="type === 'error'" />
        <Check v-else-if="type === 'success'" />
        <TriangleAlert v-else-if="type === 'warning'" />
        <Info v-else />
      </span>
      <span class="toast-message">{{ message }}</span>
      <button class="icon-button" title="关闭通知" aria-label="关闭通知" @click="close">
        <X />
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: var(--space-6);
  right: var(--space-6);
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: min(calc(100% - var(--space-8)), var(--toast-max-width));
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}
.toast.error {
  border-color: var(--error);
}
.toast.success {
  border-color: var(--success);
}
.toast.warning {
  border-color: var(--warning);
}
.toast-icon {
  display: flex;
  flex-shrink: 0;
  color: var(--info);
}
.toast-icon svg {
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
}
.error .toast-icon {
  color: var(--error);
}
.success .toast-icon {
  color: var(--success);
}
.warning .toast-icon {
  color: var(--warning);
}
.toast-message {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity var(--transition-base);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
@media (max-width: 768px) {
  .toast {
    top: var(--space-4);
    right: var(--space-4);
    left: var(--space-4);
  }
}
</style>
