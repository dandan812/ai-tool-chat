<script setup lang="ts">
/**
 * 文件上传组件
 * 支持拖拽上传文本文件
 *
 * 功能特性：
 * - 支持点击选择或拖拽上传
 * - 显示已上传文件列表
 * - 文件类型检查（仅支持文本文件）
 * - 显示文件大小和图标
 * - 支持分片上传大文件
 * - 显示上传进度
 *
 * @package frontend/src/components
 */

import { ref } from 'vue'
import type { FileData, UploadProgress } from '../types/task'
import { fileToFileData, isSupportedTextFile, formatFileSize, getFileIcon } from '../utils/file'
import {
  uploadChunkedFile,
  shouldUseChunking
} from '../utils/chunk'

/**
 * 组件属性
 */
interface Props {
  /** 已上传的文件列表 */
  files: FileData[]
}

defineProps<Props>()

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 添加文件事件 */
  add: [file: FileData]
  /** 移除文件事件 */
  remove: [id: string]
  /** 上传进度事件 */
  uploadProgress: [progress: UploadProgress]
}>()

/** 拖拽状态标识 */
const isDragging = ref(false)
/** 文件输入框引用 */
const inputRef = ref<HTMLInputElement | null>(null)

/** 上传进度映射 */
const uploadProgressMap = ref<Map<string, UploadProgress>>(new Map())

/**
 * 处理文件选择事件
 * 用户点击上传区域选择文件时触发
 */
async function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  await processFiles(Array.from(files))

  // 清空 input，允许重复选择同一文件
  if (inputRef.value) {
    inputRef.value.value = ''
  }
}

/**
 * 处理文件列表
 * 过滤并处理每个文件
 * @param files 待处理的文件数组
 */
async function processFiles(files: File[]) {
  for (const file of files) {
    // 检查是否支持
    if (!isSupportedTextFile(file)) {
      console.warn(`不支持的文件类型: ${file.name}`)
      continue
    }

    try {
      // 检查是否需要使用分片上传
      if (shouldUseChunking(file)) {
        // 分片上传
        const fileData = await uploadChunkedFile(file, {
          onProgress: (progress) => {
            // 更新进度映射
            uploadProgressMap.value.set(progress.fileId, progress)
            // 触发进度事件
            emit('uploadProgress', progress)
          },
        })

        emit('add', fileData)
        // 完成后清理进度
        uploadProgressMap.value.delete(fileData.id)
      } else {
        // 小文件直接读取上传
        const fileData = await fileToFileData(file)
        emit('add', fileData)
      }
    } catch (error) {
      console.error('读取文件失败:', error)
      // 清理进度
      uploadProgressMap.value.forEach((_, fileId) => {
        uploadProgressMap.value.delete(fileId)
      })
    }
  }
}

/**
 * 处理拖拽进入事件
 */
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

/**
 * 处理拖拽离开事件
 */
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

/**
 * 处理拖拽悬停事件
 */
function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

/**
 * 处理放置文件事件
 */
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  await processFiles(Array.from(files))
}

/**
 * 点击上传区域触发文件选择
 */
function handleClick() {
  inputRef.value?.click()
}

/**
 * 移除指定文件
 * @param id 要移除的文件 ID
 */
function removeFile(id: string) {
  emit('remove', id)
}

/**
 * 格式化时间（秒 → 可读格式）
 * @param seconds 秒数
 * @returns 格式化后的时间字符串
 */
function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${minutes}分${secs}秒`
  } else {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}小时${minutes}分`
  }
}

/**
 * 获取文件图标（简化版）
 * 根据文件类型返回对应的 emoji 图标
 * @param name 文件名
 * @returns emoji 图标字符串
 */
function getIcon(name: string): string {
  const icon = getFileIcon(name)
  // 返回 emoji 图标
  const emojiMap: Record<string, string> = {
    'js': '📜', 'ts': '📘', 'react': '⚛️',
    'python': '🐍', 'java': '☕', 'go': '🐹',
    'rust': '🦀', 'html': '🌐', 'css': '🎨',
    'json': '📋', 'xml': '📄', 'sql': '🗃️',
    'markdown': '📝', 'config': '⚙️', 'yaml': '📃',
    'text': '📄', 'csv': '📊', 'file': '📎'
  }
  return emojiMap[icon] || '📎'
}
</script>

<template>
  <div class="file-uploader">
    <!-- 已上传文件列表 -->
    <div v-if="files.length > 0" class="file-list">
      <div
        v-for="file in files"
        :key="file.id"
        class="file-item"
        :title="file.name"
      >
        <span class="file-icon">{{ getIcon(file.name) }}</span>
        <div class="file-info">
          <span class="file-name">{{ file.name }}</span>
          <span class="file-size">{{ formatFileSize(file.size) }}</span>
        </div>
        <button
          class="remove-btn"
          @click="removeFile(file.id)"
          title="移除文件"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- 上传进度列表 -->
    <div v-if="uploadProgressMap.size > 0" class="upload-progress-list">
      <div
        v-for="progress in uploadProgressMap.values()"
        :key="progress.fileId"
        class="upload-progress-item"
      >
        <div class="progress-header">
          <span class="progress-filename">{{ progress.fileName }}</span>
          <span class="progress-percentage">{{ progress.percentage.toFixed(1) }}%</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" :style="{ width: `${progress.percentage}%` }"></div>
        </div>
        <div class="progress-info">
          <span>{{ progress.uploadedChunks }}/{{ progress.totalChunks }} 片</span>
          <span v-if="progress.speed > 0">{{ progress.speed.toFixed(1) }} KB/s</span>
          <span v-if="progress.estimatedTime > 0">
            剩余 {{ formatTime(progress.estimatedTime) }}
          </span>
        </div>
      </div>
    </div>

    <!-- 上传区域 -->
    <div
      class="upload-zone"
      :class="{ dragging: isDragging }"
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
      
      <div class="upload-content">
        <svg class="upload-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <span class="upload-text">
          {{ isDragging ? '松开以上传' : '点击或拖拽上传文件' }}
        </span>
        <span class="upload-hint">
          支持 txt, md, json, js, py, java, go, sql 等代码文件
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-uploader {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* 文件列表 */
.file-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.file-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
}

.file-item:hover {
  border-color: var(--border-color);
  background: var(--bg-tertiary);
}

.file-icon {
  font-size: var(--text-xl);
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.file-name {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-size {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.remove-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* 上传进度列表 */
.upload-progress-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.upload-progress-item {
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.progress-filename {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.progress-percentage {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--accent-primary);
}

.progress-bar-container {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  overflow: hidden;
  margin-bottom: var(--space-2);
}

.progress-bar {
  height: 100%;
  background: var(--accent-primary);
  transition: width 0.3s ease;
  border-radius: var(--radius-sm);
}

.progress-info {
  display: flex;
  gap: var(--space-3);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* 上传区域 */
.upload-zone {
  position: relative;
  padding: var(--space-6);
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.upload-zone:hover,
.upload-zone.dragging {
  border-color: var(--accent-primary);
  background: var(--accent-bg);
}

.upload-zone.dragging {
  transform: scale(1.02);
}

.hidden-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  pointer-events: none;
}

.upload-icon {
  color: var(--text-muted);
  transition: all var(--transition-fast);
}

.upload-zone:hover .upload-icon,
.upload-zone.dragging .upload-icon {
  color: var(--accent-primary);
  transform: translateY(-2px);
}

.upload-text {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
}

.upload-hint {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-align: center;
}

/* 响应式 */
@media (max-width: 640px) {
  .upload-zone {
    padding: var(--space-4);
  }

  .upload-hint {
    display: none;
  }
}
</style>
