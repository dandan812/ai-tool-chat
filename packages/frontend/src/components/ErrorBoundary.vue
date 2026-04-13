<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
import { getUserFriendlyError, reportAppError } from '../utils/error'

interface Props {
  title?: string
  message?: string
}

const props = withDefaults(defineProps<Props>(), {
  title: '当前区域加载失败',
  message: '发生了意外错误，请重试当前区域。',
})

const hasError = ref(false)
const displayError = ref('')
const resetKey = ref(0)

function resetBoundary() {
  hasError.value = false
  displayError.value = ''
  resetKey.value += 1
}

onErrorCaptured((error, instance, info) => {
  hasError.value = true
  displayError.value = getUserFriendlyError(error as Error, props.message)
  const component = (instance as { type?: { __name?: string; name?: string } } | null)?.type
  reportAppError(error as Error, 'component-boundary', {
    info,
    component: component?.__name || component?.name || 'anonymous',
  })
  return false
})
</script>

<template>
  <div :key="resetKey" class="error-boundary">
    <slot v-if="!hasError" />

    <section v-else class="error-fallback" role="alert">
      <h3>{{ title }}</h3>
      <p>{{ displayError || message }}</p>
      <button type="button" @click="resetBoundary">重试当前区域</button>
    </section>
  </div>
</template>

<style scoped>
.error-boundary {
  min-width: 0;
}

.error-fallback {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid rgba(239, 68, 68, 0.18);
  border-radius: var(--radius-xl);
  background: var(--danger-soft);
  color: var(--text-primary);
}

.error-fallback h3 {
  font-size: var(--text-base);
  font-weight: 700;
}

.error-fallback p {
  color: var(--text-secondary);
  line-height: 1.7;
}

.error-fallback button {
  width: fit-content;
  padding: 0.7rem 1rem;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--accent-primary);
  color: white;
  cursor: pointer;
}
</style>
