<script setup lang="ts">
/**
 * 聊天输入组件 - 《反主流》美学
 *
 * 设计理念：
 * - 有机圆角输入框
 * - 温暖的橙色强调
 * - 柔和阴影和微交互
 *
 * 功能特性：
 * - 文本输入与自动调整高度
 * - 图片上传和预览
 * - 文件上传和预览
 * - 支持粘贴图片和文本文件
 * - 发送消息控制
 *
 * @package frontend/src/components
 */

import { ref, computed } from 'vue'
import type { ImageData, FileData } from '../types/task'
import ImageUploader from './ImageUploader.vue'
import FileUploader from './FileUploader.vue'
import { useAutoResize } from '../composables/useAutoResize'
import { fileToImageData } from '../utils/image'
import { isSupportedTextFile } from '../utils/file'
import { fileToFileData } from '../utils/file'

/**
 * 组件属性
 */
interface Props {
  /** 是否正在加载中（AI 响应中） */
  loading?: boolean
}

const props = defineProps<Props>()

/**
 * 组件事件
 */
const emit = defineEmits<{
  /** 发送消息事件 */
  send: [content: string, images: ImageData[], files: FileData[]]
}>()

/** 输入框内容 */
const input = ref('')
/** 已上传的图片列表 */
const images = ref<ImageData[]>([])
/** 已上传的文件列表 */
const files = ref<FileData[]>([])
/** 是否显示图片上传器 */
const showImageUploader = ref(false)
/** 是否显示文件上传器 */
const showFileUploader = ref(false)

/**
 * 计算属性：是否可以发送消息
 * 必须有内容或附件，且不在加载状态
 */
const canSend = computed(() => {
  return (input.value.trim() || images.value.length > 0 || files.value.length > 0) && !props.loading
})

/** 向父组件暴露清空方法 */
defineExpose({
  clear: () => {
    input.value = ''
    images.value = []
    files.value = []
    showImageUploader.value = false
    showFileUploader.value = false
    reset()
  }
})

/** 自动调整文本框高度的 composable */
const { textareaRef, resize, reset } = useAutoResize()

/**
 * 处理粘贴事件（图片）
 * 用户粘贴图片时自动添加到上传列表
 */
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

/**
 * 处理粘贴事件（文本文件）
 * 用户粘贴文本文件时自动添加到上传列表
 */
async function handleFilePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    const file = item.getAsFile()
    if (file && isSupportedTextFile(file)) {
      try {
        const fileData = await fileToFileData(file)
        addFile(fileData)
        showFileUploader.value = true
      } catch (err) {
        console.error('Failed to paste file:', err)
      }
    }
  }
}

/**
 * 添加图片到上传列表
 * @param image 图片数据
 */
function addImage(image: ImageData) {
  images.value.push(image)
}

/**
 * 从上传列表移除图片
 * @param id 图片 ID
 */
function removeImage(id: string) {
  images.value = images.value.filter((img) => img.id !== id)
}

/**
 * 添加文件到上传列表
 * @param file 文件数据
 */
function addFile(file: FileData) {
  files.value.push(file)
}

/**
 * 从上传列表移除文件
 * @param id 文件 ID
 */
function removeFile(id: string) {
  files.value = files.value.filter((f) => f.id !== id)
}

/**
 * 处理发送消息事件
 * 清空输入框和上传列表后发送
 */
function handleSend() {
  if (!canSend.value) return
  emit('send', input.value.trim(), images.value, files.value)
  // 发送后清空
  input.value = ''
  images.value = []
  files.value = []
  showImageUploader.value = false
  showFileUploader.value = false
  reset()
}

/**
 * 处理键盘按下事件
 * Enter 发送，Shift+Enter 换行
 */
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

    <!-- 文件上传区域 -->
    <div v-if="showFileUploader" class="file-area">
      <FileUploader :files="files" @add="addFile" @remove="removeFile" />
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
        <button
          class="tool-btn"
          :class="{ active: showFileUploader }"
          @click="showFileUploader = !showFileUploader"
          title="添加文件"
          aria-label="添加文件"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 8 20 8"></polyline>
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
        @paste="(e) => { handlePaste(e); handleFilePaste(e); }"
      />

      <!-- 发送按钮 -->
      <button
        v-if="!loading"
        class="action-btn send"
        :disabled="!canSend"
        @click="handleSend"
        aria-label="发送"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9"></polygon>
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
.image-area,
.file-area {
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

/* 输入框主体 - 有机胶囊形状 */
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

  .image-area,
  .file-area {
    padding: var(--space-3);
  }

  .input-box {
    padding: var(--space-2) var(--space-3);
  }

  .input-hint {
    display: none;
  }
}
</style>
