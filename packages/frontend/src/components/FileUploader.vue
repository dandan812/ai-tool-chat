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
import type { UploadedFileRef, UploadProgress } from '../types/task'
import { formatFileSize, getFileIcon, isSupportedTextFile } from '../utils/file'
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
  for (const file of fileList) {
    if (!isSupportedTextFile(file)) {
      console.warn(`不支持的文件类型: ${file.name}`)
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
      console.error('读取文件失败:', error)
      uploadProgressMap.value.clear()
      emit('uploadError', error instanceof Error ? error.message : '文件上传失败')
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

/**
 * 显示文件图标
 * @param name 文件名
 */
function getIcon(name: string): string {
  const icon = getFileIcon(name)
  const emojiMap: Record<string, string> = {
    js: '📜',
    ts: '📘',
    react: '⚛️',
    python: '🐍',
    java: '☕',
    go: '🐹',
    rust: '🦀',
    html: '🌐',
    css: '🎨',
    json: '📋',
    xml: '📄',
    sql: '🗃️',
    markdown: '📝',
    config: '⚙️',
    yaml: '📃',
    text: '📄',
    csv: '📊',
    file: '📎'
  }

  return emojiMap[icon] || '📎'
}
</script>

<template>
  <div class="file-uploader">
    <div v-if="files.length > 0" class="file-list">
      <article
        v-for="file in files"
        :key="file.fileId"
        class="file-chip"
        :title="file.fileName"
      >
        <span class="file-icon">{{ getIcon(file.fileName) }}</span>
        <div class="file-copy">
          <span class="file-name">{{ file.fileName }}</span>
          <span class="file-meta">{{ formatFileSize(file.size) }} · 已引用</span>
        </div>
        <button class="remove-btn" type="button" title="移除文件" @click="removeFile(file.fileId)">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </article>
    </div>

    <div v-if="uploadProgressMap.size > 0" class="progress-list">
      <article
        v-for="progress in uploadProgressMap.values()"
        :key="progress.fileId"
        class="progress-card"
      >
        <div class="progress-head">
          <div class="progress-copy">
            <span class="progress-name">{{ progress.fileName }}</span>
            <span class="progress-meta">
              {{ progress.uploadedChunks }}/{{ progress.totalChunks }} 片
              <template v-if="progress.speed > 0"> · {{ progress.speed.toFixed(1) }} KB/s</template>
            </span>
          </div>
          <span class="progress-percent">{{ progress.percentage.toFixed(1) }}%</span>
        </div>

        <div class="progress-track">
          <div class="progress-bar" :style="{ width: `${progress.percentage}%` }"></div>
        </div>

        <span v-if="progress.estimatedTime > 0" class="progress-eta">
          预计剩余 {{ formatTime(progress.estimatedTime) }}
        </span>
      </article>
    </div>

    <button
      class="upload-zone"
      :class="{ dragging: isDragging }"
      type="button"
      @click="handleClick"
      @dragenter="handleDragEnter"
      @dragleave="handleDragLeave"
      @dragover="handleDragOver"
      @drop="handleDrop"
    >
      <input
        ref="inputRef"
        type="file"
        multiple
        accept=".txt,.md,.json,.xml,.csv,.js,.ts,.py,.java,.go,.rs,.html,.css,.vue,.sql,.yaml,.yml,.log,.ini,.conf,.env"
        class="hidden-input"
        @change="handleFileSelect"
      />

      <span class="upload-zone-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
      </span>
      <span class="upload-zone-copy">
        {{ isDragging ? '松开后开始上传' : '点击或拖拽添加文本 / 代码文件' }}
      </span>
      <span class="upload-zone-hint">
        上传完成后只保留文件引用，提问时不会重复传整份正文。
      </span>
    </button>
  </div>
</template>

<style scoped>
.file-uploader {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.file-list,
.progress-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.file-chip,
.progress-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-strong);
}

.file-chip {
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
}

.file-chip:hover {
  transform: translateY(-1px);
  border-color: rgba(201, 106, 23, 0.18);
  box-shadow: var(--shadow-panel);
}

.file-icon {
  font-size: var(--text-xl);
  flex-shrink: 0;
}

.file-copy,
.progress-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.file-name,
.progress-name {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta,
.progress-meta,
.progress-eta {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.remove-btn:hover {
  background: var(--danger-soft);
  color: var(--error);
}

.progress-card {
  align-items: stretch;
  flex-direction: column;
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.progress-percent {
  color: var(--accent-primary);
  font-size: var(--text-sm);
  font-weight: 700;
  flex-shrink: 0;
}

.progress-track {
  width: 100%;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  transition: width var(--transition-base);
}

.upload-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-5);
  border: 1px dashed rgba(201, 106, 23, 0.24);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, var(--surface-strong) 100%);
  color: var(--text-secondary);
  cursor: pointer;
  transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.upload-zone:hover,
.upload-zone.dragging {
  transform: translateY(-1px);
  border-color: rgba(201, 106, 23, 0.36);
  box-shadow: var(--shadow-panel);
}

.hidden-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
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
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 768px) {
  .upload-zone {
    padding: var(--space-4);
  }
}
</style>
