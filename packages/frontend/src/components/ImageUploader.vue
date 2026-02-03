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
      const imageData = await new Promise<ImageData>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          const base64 = (e.target?.result as string).split(',')[1]
          resolve({
            id: crypto.randomUUID(),
            base64: base64 || '',
            mimeType: file.type,
            description: file.name
          })
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
      emit('add', imageData)
    } catch (error) {
      console.error('Failed to process image:', error)
      alert(`处理图片失败: ${file.name}`)
    }
  }
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
        <button class="remove-btn" @click="removeImage(image.id)" title="移除图片" aria-label="移除图片">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
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
        <span class="upload-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </span>
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
  gap: 14px;
}

/* 图片预览列表 */
.image-preview-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.image-preview-item {
  position: relative;
  width: 90px;
  height: 90px;
  border-radius: 12px;
  overflow: hidden;
  border: 2px solid var(--border-color);
  box-shadow: var(--card-shadow);
  transition: var(--transition);
}

.image-preview-item:hover {
  box-shadow: var(--card-shadow-hover);
}

.image-preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--error-color);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  opacity: 0;
  transition: var(--transition);
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.4);
}

.remove-btn svg {
  width: 14px;
  height: 14px;
}

.image-preview-item:hover .remove-btn {
  opacity: 1;
}

.remove-btn:hover {
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.6);
}

.remove-btn:focus-visible {
  opacity: 1;
  outline: 2px solid var(--error-color);
  outline-offset: 2px;
}

/* 上传区域 */
.upload-zone {
  border: 2.5px dashed var(--border-color);
  border-radius: 16px;
  padding: 24px;
  cursor: pointer;
  transition: var(--transition);
  background: var(--bg-color);
  box-shadow: var(--card-shadow);
}

.upload-zone:hover {
  border-color: var(--accent-color);
  background: var(--input-wrapper-bg);
  box-shadow: var(--card-shadow-hover), var(--glow-shadow);
}

.upload-zone:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.upload-zone.dragging {
  border-color: var(--accent-color);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
  box-shadow: var(--glow-shadow);
}

.file-input {
  display: none;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.upload-icon {
  transition: var(--transition);
}

.upload-zone:hover .upload-icon {
  color: var(--accent-color);
}

.upload-text {
  font-size: 15px;
  color: var(--text-color);
  font-weight: 500;
}

.upload-hint {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 400;
}
</style>
