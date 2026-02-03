<script setup lang="ts">
/**
 * 文件上传组件
 * 支持拖拽上传文本文件
 */
import { ref } from 'vue'
import type { FileData } from '../types/task'
import { fileToFileData, isSupportedTextFile, formatFileSize, getFileIcon } from '../utils/file'

interface Props {
  files: FileData[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  add: [file: FileData]
  remove: [id: string]
}>()

const isDragging = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

/**
 * 处理文件选择
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
 */
async function processFiles(files: File[]) {
  for (const file of files) {
    // 检查是否支持
    if (!isSupportedTextFile(file)) {
      console.warn(`不支持的文件类型: ${file.name}`)
      continue
    }

    try {
      const fileData = await fileToFileData(file)
      emit('add', fileData)
    } catch (error) {
      console.error('读取文件失败:', error)
    }
  }
}

/**
 * 处理拖拽进入
 */
function handleDragEnter(e: DragEvent) {
  e.preventDefault()
  isDragging.value = true
}

/**
 * 处理拖拽离开
 */
function handleDragLeave(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
}

/**
 * 处理拖拽悬停
 */
function handleDragOver(e: DragEvent) {
  e.preventDefault()
}

/**
 * 处理放置文件
 */
async function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false

  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return

  await processFiles(Array.from(files))
}

/**
 * 点击上传区域
 */
function handleClick() {
  inputRef.value?.click()
}

/**
 * 移除文件
 */
function removeFile(id: string) {
  emit('remove', id)
}

/**
 * 获取文件图标（简化版）
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
