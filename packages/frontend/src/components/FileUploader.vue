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

import { onScopeDispose, ref } from 'vue'
import { FileText, FileSpreadsheet, LoaderCircle, Upload, X } from '@lucide/vue'
import type { UploadedFileRef, UploadProgress } from '../types/task'
import { formatFileSize, isSupportedUploadFile, SUPPORTED_UPLOAD_ACCEPT } from '../utils/file'
import { uploadChunkedFile } from '../utils/chunk'

interface Props {
  /** 已上传文件 */
  files: UploadedFileRef[]
  compact?: boolean
  disabled?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  /** 添加文件 */
  add: [file: UploadedFileRef]
  /** 移除文件 */
  remove: [id: string]
  /** 上传进度 */
  uploadProgress: [progress: UploadProgress]
  /** 上传错误 */
  uploadError: [message: string]
  busy: [value: boolean]
}>()

/** 拖拽状态 */
const isDragging = ref(false)
/** 文件输入框引用 */
const inputRef = ref<HTMLInputElement | null>(null)
/** 上传进度映射 */
const uploadProgressMap = ref<Map<string, UploadProgress>>(new Map())
const busy = ref(false)
const error = ref('')
let disposed = false
onScopeDispose(() => {
  disposed = true
})

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
  if (disposed || busy.value || props.disabled || !fileList.length) return
  busy.value = true
  emit('busy', true)
  error.value = ''
  let uploadedAfterError = false
  try {
    for (const file of fileList) {
      if (disposed || props.disabled) break
      if (!isSupportedUploadFile(file)) {
        error.value = `不支持的文件类型：${file.name}`
        emit('uploadError', error.value)
        uploadedAfterError = false
        continue
      }

      try {
        const uploadedFile = await uploadChunkedFile(file, {
          onProgress: (progress) => {
            if (disposed) return
            uploadProgressMap.value.set(progress.fileId, progress)
            emit('uploadProgress', progress)
          }
        })

        if (disposed) break
        emit('add', uploadedFile)
        if (error.value) uploadedAfterError = true
        uploadProgressMap.value.delete(uploadedFile.fileId)
      } catch (uploadFailure) {
        if (disposed) break
        uploadProgressMap.value.clear()
        error.value = uploadFailure instanceof Error ? uploadFailure.message : '文件上传失败'
        emit('uploadError', error.value)
        uploadedAfterError = false
      }
    }
  } finally {
    busy.value = false
    if (!disposed) {
      if (uploadedAfterError) emit('uploadError', error.value)
      emit('busy', false)
    }
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
  if (busy.value || props.disabled) return
  inputRef.value?.click()
}

/**
 * 移除文件
 * @param id 文件 ID
 */
function removeFile(id: string) {
  if (props.disabled) return
  emit('remove', id)
}

defineExpose({ open: handleClick, addFiles: processFiles })

function fileType(name: string) {
  return name.includes('.') ? name.split('.').pop()!.toUpperCase() : 'FILE'
}

function fileKind(name: string) {
  const type = fileType(name)
  if (['XLS', 'XLSX', 'CSV'].includes(type)) return 'sheet'
  if (type === 'PDF') return 'pdf'
  if (['DOC', 'DOCX'].includes(type)) return 'document'
  return 'text'
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
  <div class="file-uploader" :class="{ compact }">
    <div v-if="files.length" class="file-list">
      <div
        v-for="file in files"
        :key="file.fileId"
        class="file-chip attachment-card"
        :data-kind="fileKind(file.fileName)"
      >
        <div class="file-preview" aria-hidden="true">
          <FileSpreadsheet v-if="fileKind(file.fileName) === 'sheet'" />
          <FileText v-else />
          <span>{{ fileType(file.fileName) }}</span>
        </div>
        <div class="file-caption">
          <FileSpreadsheet v-if="fileKind(file.fileName) === 'sheet'" aria-hidden="true" />
          <FileText v-else aria-hidden="true" />
          <div class="file-copy">
            <span class="file-name" :title="file.fileName">{{ file.fileName }}</span>
            <span class="file-meta"
              >{{ fileType(file.fileName) }} · {{ formatFileSize(file.size) }}</span
            >
          </div>
        </div>
        <button
          class="icon-button remove-btn"
          type="button"
          title="移除附件"
          aria-label="移除附件"
          :disabled="disabled"
          @click="removeFile(file.fileId)"
        >
          <X />
        </button>
      </div>
    </div>
    <div
      v-for="[id, progress] in uploadProgressMap"
      :key="id"
      class="progress-card attachment-card"
      aria-busy="true"
    >
      <div class="file-preview uploading-preview">
        <LoaderCircle class="spin" aria-hidden="true" />
        <span class="progress-percent">{{ progress.percentage.toFixed(0) }}%</span>
      </div>
      <div class="file-caption">
        <FileText aria-hidden="true" />
        <div class="file-copy">
          <span class="file-name" :title="progress.fileName">{{ progress.fileName }}</span>
          <span class="file-meta">{{
            progress.percentage >= 100
              ? '处理中…'
              : `上传中 · ${formatTime(progress.estimatedTime)}`
          }}</span>
        </div>
      </div>
      <progress
        :value="progress.percentage"
        max="100"
        :aria-label="progress.fileName + ' 上传进度'"
      />
    </div>
    <button
      v-if="!compact"
      class="upload-zone"
      :class="{ dragging: isDragging }"
      type="button"
      :disabled="disabled || busy"
      @click="handleClick"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
    >
      <Upload /><span>{{ busy ? '上传中…' : '选择文件' }}</span>
    </button>
    <input
      ref="inputRef"
      type="file"
      multiple
      class="file-input"
      :accept="SUPPORTED_UPLOAD_ACCEPT"
      :disabled="disabled || busy"
      @change="handleFileSelect"
    />
    <p v-if="error && !compact" class="status-banner is-error" role="alert">{{ error }}</p>
  </div>
</template>
