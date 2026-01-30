<script setup lang="ts">
/**
 * 图片上传组件
 * 支持多模态对话的图片选择和预览
 */
import { ref } from 'vue'
import type { ImageData } from '../types/task'

interface Props {
  images: ImageData[]
  maxImages?: number
}

const props = withDefaults(defineProps<Props>(), {
  maxImages: 4
})

const emit = defineEmits<{
  add: [image: ImageData]
  remove: [id: string]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

/**
 * 处理文件选择
 */
function handleFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) {
    processFiles(Array.from(input.files))
  }
  // 重置 input 以便可以重复选择相同文件
  input.value = ''
}

/**
 * 处理拖拽文件
 */
function handleDrop(event: DragEvent) {
  isDragging.value = false
  const files = event.dataTransfer?.files
  if (files) {
    processFiles(Array.from(files))
  }
}

/**
 * 处理文件列表
 */
async function processFiles(files: File[]) {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))

  for (const file of imageFiles) {
    if (props.images.length >= props.maxImages) {
      alert(`最多只能上传 ${props.maxImages} 张图片`)
      break
    }

    try {
      const imageData = await fileToImageData(file)
      emit('add', imageData)
    } catch (error) {
      console.error('Failed to process image:', error)
      alert(`处理图片失败: ${file.name}`)
    }
  }
}

/**
 * 将 File 转换为 ImageData
 */
function fileToImageData(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const base64 = reader.result as string
      // 移除 data:image/xxx;base64, 前缀
      const base64Data = base64.split(',')[1]

      resolve({
        id: generateId(),
        base64: base64Data || '',
        mimeType: file.type,
        file: file
      })
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 触发文件选择
 */
function triggerFileSelect() {
  fileInput.value?.click()
}

/**
 * 移除图片
 */
function removeImage(id: string) {
  emit('remove', id)
}
</script>

<template>
  <div class="image-uploader">
    <!-- 图片预览列表 -->
    <div v-if="images.length > 0" class="image-preview-list">
      <div v-for="image in images" :key="image.id" class="image-preview-item">
        <img
          :src="`data:${image.mimeType};base64,${image.base64}`"
          :alt="image.description || 'Uploaded image'"
        />
        <button class="remove-btn" @click="removeImage(image.id)" title="移除图片">×</button>
      </div>
    </div>

    <!-- 上传区域 -->
    <div
      v-if="images.length < maxImages"
      class="upload-zone"
      :class="{ dragging: isDragging }"
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
      <div class="upload-content">
        <span class="upload-icon">📷</span>
        <span class="upload-text">
          {{ isDragging ? '松开以上传' : '点击或拖拽上传图片' }}
        </span>
        <span class="upload-hint"> 支持 JPG、PNG、GIF，最多 {{ maxImages }} 张 </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-uploader {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 图片预览列表 */
.image-preview-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-preview-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--border-color);
}

.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--error-color);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-preview-item:hover .remove-btn {
  opacity: 1;
}

/* 上传区域 */
.upload-zone {
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  background: var(--bg-color);
}

.upload-zone:hover {
  border-color: var(--accent-color);
  background: var(--input-wrapper-bg);
}

.upload-zone.dragging {
  border-color: var(--accent-color);
  background: var(--accent-color);
  background-opacity: 0.1;
}

.file-input {
  display: none;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  font-size: 24px;
}

.upload-text {
  font-size: 14px;
  color: var(--text-color);
}

.upload-hint {
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
