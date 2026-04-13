<script setup lang="ts">
/**
 * 图片上传组件
 *
 * 目标：
 * - 保留现有图片处理逻辑
 * - 提供更适合 composer 附件托盘的轻量展示
 *
 * @package frontend/src/components
 */

import { ref } from 'vue'
import type { DraftImage } from '../types/task'

interface Props {
  /** 已选择图片 */
  images: DraftImage[]
  /** 最大数量 */
  maxImages?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxImages: 4
})

const emit = defineEmits<{
  /** 添加图片 */
  add: [file: File]
  /** 移除图片 */
  remove: [id: string]
}>()

/** 文件输入框引用 */
const fileInput = ref<HTMLInputElement | null>(null)
/** 拖拽状态 */
const isDragging = ref(false)

/**
 * 处理文件选择
 * @param event change 事件
 */
function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    processFiles(Array.from(input.files))
  }
  input.value = ''
}

/**
 * 处理拖拽释放
 * @param event 拖拽事件
 */
function handleDrop(event: DragEvent) {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) {
    processFiles(Array.from(files))
  }
}

/**
 * 批量处理图片
 * @param files 文件列表
 */
async function processFiles(files: File[]) {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))

  for (const file of imageFiles) {
    if (props.images.length >= props.maxImages) {
      alert(`最多只能上传 ${props.maxImages} 张图片`)
      break
    }

    emit('add', file)
  }
}

/** 打开文件选择器 */
function triggerFileSelect() {
  fileInput.value?.click()
}

/**
 * 移除图片
 * @param id 图片 ID
 */
function removeImage(id: string) {
  emit('remove', id)
}
</script>

<template>
  <div class="image-uploader">
    <div v-if="images.length > 0" class="image-strip">
      <article v-for="image in images" :key="image.id" class="image-card">
        <img
          :src="image.previewUrl"
          :alt="image.description || '上传图片'"
        />

        <div class="image-overlay">
          <span class="image-name">{{ image.description || '未命名图片' }}</span>
          <button
            class="remove-btn"
            type="button"
            title="移除图片"
            aria-label="移除图片"
            @click="removeImage(image.id)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </article>
    </div>

    <button
      v-if="images.length < maxImages"
      class="upload-zone"
      :class="{ dragging: isDragging }"
      type="button"
      @click="triggerFileSelect"
      @dragenter.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @dragover.prevent
      @drop.prevent="handleDrop"
    >
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="file-input"
        @change="handleFileSelect"
      />

      <span class="upload-zone-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
          <circle cx="12" cy="13" r="4"></circle>
        </svg>
      </span>
      <span class="upload-zone-copy">
        {{ isDragging ? '松开后加入图片托盘' : '点击或拖拽加入图片' }}
      </span>
      <span class="upload-zone-hint">
        支持 JPG、PNG、GIF，最多 {{ maxImages }} 张
      </span>
    </button>
  </div>
</template>

<style scoped>
.image-uploader {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.image-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--space-3);
}

.image-card {
  position: relative;
  overflow: hidden;
  min-height: 120px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-strong);
  box-shadow: var(--shadow-panel);
}

.image-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.image-overlay {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  background: linear-gradient(180deg, rgba(17, 17, 17, 0) 0%, rgba(17, 17, 17, 0.76) 100%);
}

.image-name {
  color: white;
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.remove-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.18);
  color: white;
  cursor: pointer;
  transition: background-color var(--transition-fast), transform var(--transition-fast);
}

.remove-btn:hover {
  background: rgba(239, 68, 68, 0.82);
  transform: scale(1.04);
}

.upload-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px dashed rgba(201, 106, 23, 0.24);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, var(--surface-strong) 100%);
  cursor: pointer;
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.upload-zone:hover,
.upload-zone.dragging {
  transform: translateY(-1px);
  border-color: rgba(201, 106, 23, 0.34);
  box-shadow: var(--shadow-panel);
}

.file-input {
  display: none;
}

.upload-zone-icon {
  color: var(--accent-primary);
}

.upload-zone-copy {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 700;
}

.upload-zone-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

@media (max-width: 768px) {
  .image-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .upload-zone {
    padding: var(--space-4);
  }
}
</style>
