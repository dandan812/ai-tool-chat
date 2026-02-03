<script setup lang="ts">
/**
 * 聊天输入组件 - 《反主流》美学
 * 
 * 特点：
 * - 有机圆角输入框
 * - 温暖的橙色强调
 * - 柔和阴影和微交互
 */
import { ref, computed } from 'vue'
import type { ImageData } from '../types/task'
import ImageUploader from './ImageUploader.vue'
import { useAutoResize } from '../composables/useAutoResize'
import { fileToImageData } from '../utils/image'

interface Props {
  loading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  send: [content: string, images: ImageData[]]
  stop: []
}>()

const input = ref('')
const images = ref<ImageData[]>([])
const showImageUploader = ref(false)

const canSend = computed(() => {
  return (input.value.trim() || images.value.length > 0) && !props.loading
})

defineExpose({
  clear: () => {
    input.value = ''
    images.value = []
    showImageUploader.value = false
    reset()
  }
})

const { textareaRef, resize, reset } = useAutoResize()

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        try {
          const imageData = await fileToImageData(file)
          addImage(imageData)
          showImageUploader.value = true
        } catch (err) {
          console.error('Failed to paste image:', err)
        }
      }
    }
  }
}

function addImage(image: ImageData) {
  images.value.push(image)
}

function removeImage(id: string) {
  images.value = images.value.filter((img) => img.id !== id)
}

function handleSend() {
  if (!canSend.value) return

  emit('send', input.value.trim(), images.value)

  // 发送后清空输入框
  input.value = ''
  images.value = []
  showImageUploader.value = false
  reset()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="input-section">
    <!-- 图片上传区域 -->
    <div v-if="showImageUploader" class="image-area">
      <ImageUploader :images="images" @add="addImage" @remove="removeImage" />
    </div>

    <!-- 输入框主体 -->
    <div class="input-box">
      <!-- 左侧工具栏 -->
      <div class="toolbar">
        <button
          class="tool-btn"
          :class="{ active: showImageUploader }"
          @click="showImageUploader = !showImageUploader"
          title="添加图片"
          aria-label="添加图片"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
        </button>
      </div>

      <!-- 文本输入 -->
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="loading"
        placeholder="想说点什么..."
        rows="1"
        class="message-input"
        @keydown="handleKeydown"
        @input="resize"
        @paste="handlePaste"
      />

      <!-- 发送/停止按钮 -->
      <button
        v-if="!loading"
        class="action-btn send"
        :disabled="!canSend"
        @click="handleSend"
        aria-label="发送"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
      
      <button
        v-else
        class="action-btn pause"
        @click="emit('stop')"
        title="暂停生成"
        aria-label="暂停"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      </button>
    </div>

    <!-- 快捷提示 -->
    <div class="input-hint">
      <span>Enter 发送 · Shift + Enter 换行</span>
    </div>
  </div>
</template>

<style scoped>
.input-section {
  padding: var(--space-4) var(--space-6);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-subtle);
}

/* 图片上传区域 */
.image-area {
  max-width: 900px;
  margin: 0 auto var(--space-4);
  padding: var(--space-4);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 输入框主体 - 有机药丸形状 */
.input-box {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  max-width: 900px;
  margin: 0 auto;
  padding: var(--space-3) var(--space-4);
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-2xl);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.input-box:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 3px var(--input-focus-ring), var(--shadow-md);
}

/* 工具栏 */
.toolbar {
  display: flex;
  align-items: center;
  padding-right: var(--space-3);
  border-right: 1px solid var(--border-subtle);
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tool-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.tool-btn.active {
  background: var(--accent-primary);
  color: white;
  box-shadow: var(--shadow-warm);
}

/* 文本输入 */
.message-input {
  flex: 1;
  min-height: 36px;
  max-height: 160px;
  padding: var(--space-2) 0;
  background: transparent;
  border: none;
  font-family: var(--font-sans);
  font-size: var(--text-base);
  color: var(--text-primary);
  line-height: 1.6;
  resize: none;
  outline: none;
}

.message-input::placeholder {
  color: var(--text-muted);
}

/* 操作按钮 */
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all var(--transition-base);
  flex-shrink: 0;
}

/* 发送按钮 - 橙色强调 */
.action-btn.send {
  background: var(--accent-primary);
  color: white;
  box-shadow: var(--shadow-warm);
}

.action-btn.send:hover:not(:disabled) {
  background: var(--accent-primary-hover);
  transform: translateY(-1px) scale(1.05);
  box-shadow: 0 6px 20px -4px var(--accent-glow);
}

.action-btn.send:disabled {
  background: var(--bg-tertiary);
  color: var(--text-muted);
  cursor: not-allowed;
  box-shadow: none;
}

/* 暂停按钮 - 温暖橙色 */
.action-btn.pause {
  background: linear-gradient(135deg, #F97316 0%, #FBBF24 100%);
  color: white;
  animation: pulse-warm 2s ease-in-out infinite;
}

@keyframes pulse-warm {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(249, 115, 22, 0);
  }
}

.action-btn.pause:hover {
  transform: scale(1.05);
}

/* 底部提示 */
.input-hint {
  max-width: 900px;
  margin: var(--space-3) auto 0;
  text-align: center;
}

.input-hint span {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* 响应式 */
@media (max-width: 768px) {
  .input-section {
    padding: var(--space-3) var(--space-4);
  }
  
  .input-box {
    padding: var(--space-2) var(--space-3);
  }
  
  .input-hint {
    display: none;
  }
}
</style>
