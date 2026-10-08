<script setup lang="ts">
/**
 * 文件上传组件
 *
 * 目标：
 * - 保留现有分片上传与断点续传逻辑
 * - 让文件列表、进度卡和上传入口更适合放进 composer 托盘
 *
 * @package frontend/src/components
 */

import { ref } from 'vue'
import { FileText, Upload, X } from '@lucide/vue'
import type { UploadedFileRef, UploadProgress } from '../types/task'
import { formatFileSize, isSupportedTextFile } from '../utils/file'
import { uploadChunkedFile } from '../utils/chunk'

interface Props {
  /** 已上传文件 */
  files: UploadedFileRef[]
}

defineProps<Props>()

const emit = defineEmits<{
  /** 添加文件 */
  add: [file: UploadedFileRef]
  /** 移除文件 */
  remove: [id: string]
  /** 上传进度 */
  uploadProgress: [progress: UploadProgress]
  /** 上传错误 */
  uploadError: [message: string]
}>()

/** 拖拽状态 */
const isDragging = ref(false)
/** 文件输入框引用 */
const inputRef = ref<HTMLInputElement | null>(null)
/** 上传进度映射 */
const uploadProgressMap = ref<Map<string, UploadProgress>>(new Map())
const busy = ref(false)
const error = ref('')

/**
 * 选择文件后处理
 * @param event change 事件
 */
async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const fileList = target.files
  if (!fileList || fileList.length === 0) return

  await processFiles(Array.from(fileList))

  if (inputRef.value) {
    inputRef.value.value = ''
  }
}

/**
 * 批量处理文件
 * @param fileList 文件数组
 */
async function processFiles(fileList: File[]) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    for (const file of fileList) {
      if (!isSupportedTextFile(file)) {
        error.value = `不支持的文件类型：${file.name}`
        emit('uploadError', error.value)
        continue
      }

      try {
        const uploadedFile = await uploadChunkedFile(file, {
          onProgress: (progress) => {
            uploadProgressMap.value.set(progress.fileId, progress)
            emit('uploadProgress', progress)
          }
        })

        emit('add', uploadedFile)
        uploadProgressMap.value.delete(uploadedFile.fileId)
      } catch (error) {
        uploadProgressMap.value.clear()
        emit('uploadError', error instanceof Error ? error.message : '文件上传失败')
      }
    }
  } finally {
    busy.value = false
  }
}

/** 处理拖拽进入 */
function handleDragEnter(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

/** 处理拖拽离开 */
function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
}

/** 处理拖拽悬停 */
function handleDragOver(event: DragEvent) {
  event.preventDefault()
}

/** 处理拖拽释放 */
async function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  const fileList = event.dataTransfer?.files
  if (!fileList || fileList.length === 0) return

  await processFiles(Array.from(fileList))
}

/** 打开文件选择器 */
function handleClick() {
  inputRef.value?.click()
}

/**
 * 移除文件
 * @param id 文件 ID
 */
function removeFile(id: string) {
  emit('remove', id)
}

/**
 * 格式化剩余时间
 * @param seconds 秒数
 */
function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`

  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainSeconds = Math.round(seconds % 60)
    return `${minutes} 分 ${remainSeconds} 秒`
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours} 小时 ${minutes} 分`
}
</script>

<template>
  <div class="file-uploader">
    <div v-if="files.length" class="file-list">
      <div v-for="file in files" :key="file.fileId" class="file-chip">
        <FileText />
        <div class="file-copy">
          <span class="file-name">{{ file.fileName }}</span>
          <span class="file-meta">{{ formatFileSize(file.size) }} · 已上传</span>
        </div>
        <button
          class="icon-button remove-btn"
          type="button"
          title="移除附件"
          aria-label="移除附件"
          @click="removeFile(file.fileId)"
        >
          <X />
        </button>
      </div>
    </div>
    <div v-for="[id, progress] in uploadProgressMap" :key="id" class="progress-card">
      <div class="progress-head">
        <span class="progress-name">{{ progress.fileName }}</span>
        <span class="progress-percent"
          >{{ progress.percentage.toFixed(0) }}% · {{ formatTime(progress.estimatedTime) }}</span
        >
      </div>
      <progress
        :value="progress.percentage"
        max="100"
        :aria-label="progress.fileName + ' 上传进度'"
      />
    </div>
    <button
      class="upload-zone"
      :class="{ dragging: isDragging }"
      type="button"
      :disabled="busy"
      @click="handleClick"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
    >
      <Upload /><span>{{ busy ? '上传中…' : '选择文件' }}</span>
    </button>
    <input ref="inputRef" type="file" multiple class="file-input" @change="handleFileSelect" />
    <p v-if="error" class="status-banner is-error" role="alert">{{ error }}</p>
  </div>
</template>
