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
import { MAX_IMAGES } from '../config'
import { ImagePlus, X } from '@lucide/vue'
import type { DraftImage } from '../types/task'

interface Props {
  /** 已选择图片 */
  images: DraftImage[]
  /** 最大数量 */
  maxImages?: number
  compact?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  maxImages: MAX_IMAGES
})

const emit = defineEmits<{
  /** 添加图片 */
  add: [file: File]
  /** 移除图片 */
  remove: [id: string]
  error: [message: string]
}>()

/** 文件输入框引用 */
const fileInput = ref<HTMLInputElement | null>(null)
/** 拖拽状态 */
const isDragging = ref(false)
const error = ref('')

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
function processFiles(files: File[]) {
  if (props.disabled || !files.length) return
  error.value = ''
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  const available = Math.max(0, props.maxImages - props.images.length)
  if (imageFiles.length > available) error.value = `最多选择 ${props.maxImages} 张图片`
  if (!imageFiles.length && files.length) error.value = '请选择图片文件'
  for (const file of imageFiles.slice(0, available)) {
    emit('add', file)
  }
  if (error.value) emit('error', error.value)
}

/** 打开文件选择器 */
function triggerFileSelect() {
  if (props.disabled || props.images.length >= props.maxImages) return
  fileInput.value?.click()
}

/**
 * 移除图片
 * @param id 图片 ID
 */
function removeImage(id: string) {
  if (props.disabled) return
  emit('remove', id)
}

defineExpose({ open: triggerFileSelect, addFiles: processFiles })
</script>

<template>
  <div class="image-uploader" :class="{ compact }">
    <div v-if="images.length" class="image-strip">
      <div
        v-for="image in images"
        :key="image.id"
        class="image-card"
        :title="image.description || '图片'"
      >
        <img :src="image.previewUrl" :alt="image.description || '待发送图片'" />
        <span v-if="!compact" class="image-name">{{ image.description || '图片' }}</span>
        <button
          class="icon-button remove-btn"
          type="button"
          title="移除图片"
          aria-label="移除图片"
          :disabled="disabled"
          @click="removeImage(image.id)"
        >
          <X />
        </button>
      </div>
    </div>
    <button
      v-if="!compact"
      type="button"
      class="upload-zone"
      :class="{ dragging: isDragging }"
      :disabled="disabled || images.length >= maxImages"
      @click="triggerFileSelect"
      @dragover.prevent="isDragging = true"
      @dragleave="isDragging = false"
      @drop.prevent="handleDrop"
    >
      <ImagePlus /><span>选择图片</span>
    </button>
    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden-input"
      :disabled="disabled"
      @change="handleFileSelect"
    />
    <p v-if="error && !compact" class="status-banner is-error" role="alert">{{ error }}</p>
  </div>
</template>
