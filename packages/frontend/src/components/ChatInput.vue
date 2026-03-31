<script setup lang="ts">
/**
 * 聊天输入组件
 *
 * 目标：
 * - 统一输入、附件、发送状态和快捷操作
 * - 让底部区域更像稳定的工作流面板
 *
 * @package frontend/src/components
 */

import { toRefs } from 'vue'
import type { ImageData, UploadedFileRef } from '../types/task'
import ImageUploader from './ImageUploader.vue'
import FileUploader from './FileUploader.vue'
import { useChatComposer } from '../composables/useChatComposer'

interface Props {
  /** 是否正在生成回复 */
  loading?: boolean
}

const props = defineProps<Props>()
const { loading } = toRefs(props)

const emit = defineEmits<{
  /** 发送消息 */
  send: [content: string, images: ImageData[], files: UploadedFileRef[]]
  /** 停止生成 */
  stop: []
}>()

const composer = useChatComposer({
  loading,
  onSend: (content, images, files) => emit('send', content, images, files),
})

const {
  input,
  images,
  files,
  showImageUploader,
  showFileUploader,
  pendingUploadList,
  hasPendingUploads,
  showAttachmentTray,
  canSend,
  statusText,
  statusTone,
  resize,
  addImage,
  removeImage,
  addFile,
  removeFile,
  handleUploadProgress,
  handleUploadError,
  handleKeydown,
  handlePaste,
  sendMessage,
  clearComposer,
} = composer

defineExpose({
  clear: clearComposer,
})
</script>

<template>
  <section class="composer-panel" :class="{ loading }">
    <div class="composer-toolbar">
      <div class="tool-group">
        <button
          class="tool-pill"
          :class="{ active: showImageUploader || images.length > 0 }"
          type="button"
          title="图片托盘"
          @click="showImageUploader = !showImageUploader"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>图片</span>
          <span v-if="images.length > 0" class="tool-count">{{ images.length }}</span>
        </button>

        <button
          class="tool-pill"
          :class="{ active: showFileUploader || files.length > 0 || hasPendingUploads }"
          type="button"
          title="文件托盘"
          @click="showFileUploader = !showFileUploader"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
          </svg>
          <span>文件</span>
          <span v-if="files.length + pendingUploadList.length > 0" class="tool-count">
            {{ files.length + pendingUploadList.length }}
          </span>
        </button>
      </div>

      <div class="toolbar-status">
        <span class="toolbar-chip">
          {{ loading ? '正在生成' : '准备发送' }}
        </span>
      </div>
    </div>

    <div v-if="showAttachmentTray" class="composer-attachments">
      <section v-if="showImageUploader || images.length > 0" class="attachment-block">
        <div class="attachment-head">
          <span class="attachment-title">图片附件</span>
          <span class="attachment-caption">拖拽图片、粘贴截图或直接选择文件。</span>
        </div>
        <ImageUploader :images="images" @add="addImage" @remove="removeImage" />
      </section>

      <section v-if="showFileUploader || files.length > 0 || hasPendingUploads" class="attachment-block">
        <div class="attachment-head">
          <span class="attachment-title">文件引用</span>
          <span class="attachment-caption">上传后仅保留引用，提问时不会把全文重新塞进请求。</span>
        </div>
        <FileUploader
          :files="files"
          @add="addFile"
          @remove="removeFile"
          @upload-progress="handleUploadProgress"
          @upload-error="handleUploadError"
        />
      </section>
    </div>

    <div class="composer-body">
      <textarea
        :ref="composer.textareaRef"
        v-model="input"
        class="message-input"
        :disabled="loading"
        rows="1"
        placeholder="描述任务、补充上下文，或直接贴入你要分析的内容。"
        @keydown="handleKeydown"
        @input="resize"
        @paste="handlePaste"
      />

      <div class="composer-actions">
        <button
          v-if="!loading"
          class="primary-action send"
          :disabled="!canSend"
          type="button"
          @click="sendMessage"
        >
          <span>发送</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9"></polygon>
          </svg>
        </button>

        <button
          v-else
          class="primary-action stop"
          type="button"
          @click="emit('stop')"
        >
          <span>停止</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="1"></rect>
          </svg>
        </button>
      </div>
    </div>

    <div class="composer-footer">
      <div class="status-banner" :class="statusTone">
        <span class="status-dot"></span>
        <span>{{ statusText }}</span>
      </div>

      <div class="shortcut-hint">
        <span>支持粘贴图片与文本文件</span>
        <span class="separator">·</span>
        <span>Shift + Enter 换行</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.composer-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid rgba(201, 106, 23, 0.14);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, var(--surface-panel) 0%, var(--surface-strong) 100%);
  box-shadow: var(--shadow-float);
  backdrop-filter: blur(20px);
}

.composer-panel.loading {
  border-color: rgba(201, 106, 23, 0.22);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.tool-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.tool-pill,
.toolbar-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 36px;
  padding: 0.45rem 0.8rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-subtle);
  background: var(--surface-strong);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tool-pill:hover {
  border-color: var(--border-default);
  color: var(--text-primary);
  transform: translateY(-1px);
}

.tool-pill.active {
  background: var(--accent-soft);
  border-color: rgba(201, 106, 23, 0.16);
  color: var(--accent-primary);
}

.tool-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 0.35rem;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.7);
  font-size: 11px;
}

.toolbar-chip {
  cursor: default;
  background: var(--surface-muted);
  color: var(--text-tertiary);
}

.composer-attachments {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-1);
}

.attachment-block {
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: rgba(255, 255, 255, 0.34);
}

.attachment-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
}

.attachment-title {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 700;
}

.attachment-caption {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.6;
}

.composer-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4);
  align-items: flex-end;
  padding: var(--space-4);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-lg);
  background: var(--input-bg);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.composer-body:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: 0 0 0 4px var(--focus-ring-strong);
}

.message-input {
  width: 100%;
  min-height: 56px;
  max-height: 220px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.7;
  resize: none;
  outline: none;
}

.message-input::placeholder {
  color: var(--text-muted);
}

.composer-actions {
  display: flex;
  align-items: center;
}

.primary-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 108px;
  justify-content: center;
  padding: 0.9rem 1rem;
  border: none;
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: 700;
  color: white;
  cursor: pointer;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), background-color var(--transition-fast);
}

.primary-action.send {
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  box-shadow: var(--shadow-warm);
}

.primary-action.send:hover:not(:disabled),
.primary-action.stop:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-panel);
}

.primary-action.send:disabled {
  background: var(--bg-tertiary);
  color: var(--text-muted);
  cursor: not-allowed;
  box-shadow: none;
}

.primary-action.stop {
  background: linear-gradient(135deg, #dc2626 0%, #f97316 100%);
}

.composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.status-banner {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0.45rem 0.7rem;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--surface-muted);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-banner.is-idle {
  color: var(--text-tertiary);
}

.status-banner.is-busy,
.status-banner.is-streaming {
  color: var(--accent-primary);
  background: var(--accent-soft);
}

.status-banner.is-error {
  color: var(--error);
  background: var(--danger-soft);
}

.shortcut-hint {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.separator {
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .composer-panel {
    padding: var(--space-3);
    gap: var(--space-3);
  }

  .composer-body {
    grid-template-columns: 1fr;
    padding: var(--space-3);
  }

  .composer-actions {
    width: 100%;
  }

  .primary-action {
    width: 100%;
  }

  .shortcut-hint {
    display: none;
  }
}
</style>
