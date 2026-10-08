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
import type { UploadedFileRef } from '../types/task'
import ImageUploader from './ImageUploader.vue'
import FileUploader from './FileUploader.vue'
import { useChatComposer } from '../composables/useChatComposer'
import { Image, FileText, ArrowUp, Square } from '@lucide/vue'

interface Props {
  /** 是否正在生成回复 */
  loading?: boolean
  /** 当前会话 ID */
  sessionId: string
}

const props = defineProps<Props>()
const { loading, sessionId } = toRefs(props)

const emit = defineEmits<{
  /** 发送消息 */
  send: [content: string, images: import('../types/task').ImageData[], files: UploadedFileRef[]]
  /** 停止生成 */
  stop: []
}>()

const composer = useChatComposer({
  loading,
  sessionId,
  onSend: (content, images, files) => emit('send', content, images, files)
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
  removeImage,
  addFile,
  removeFile,
  handleUploadProgress,
  handleUploadError,
  handleKeydown,
  handlePaste,
  sendMessage,
  clearComposer
} = composer

async function handleImageAdd(file: File) {
  try {
    await composer.addImage(file)
  } catch (error) {
    composer.handleUploadError(error instanceof Error ? error.message : '图片处理失败')
  }
}

defineExpose({
  clear: clearComposer
})
</script>

<template>
  <section class="composer-panel" :class="{ loading }" aria-label="消息输入">
    <div v-if="showAttachmentTray" class="composer-attachments">
      <section v-if="showImageUploader || images.length" class="attachment-block">
        <span class="attachment-title">图片</span>
        <ImageUploader :images="images" @add="handleImageAdd" @remove="removeImage" />
      </section>
      <section
        v-if="showFileUploader || files.length || hasPendingUploads"
        class="attachment-block"
      >
        <span class="attachment-title">文件</span>
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
        rows="2"
        placeholder="输入问题…"
        aria-label="输入问题"
        @keydown="handleKeydown"
        @input="resize"
        @paste="handlePaste"
      />
    </div>
    <div class="composer-toolbar">
      <div class="tool-group">
        <button
          class="tool-pill"
          :class="{ active: showImageUploader || images.length }"
          type="button"
          title="图片托盘"
          :aria-pressed="showImageUploader"
          @click="showImageUploader = !showImageUploader"
        >
          <Image /><span>图片</span
          ><span v-if="images.length" class="tool-count">{{ images.length }}</span>
        </button>
        <button
          class="tool-pill"
          :class="{ active: showFileUploader || files.length || hasPendingUploads }"
          type="button"
          title="文件托盘"
          :aria-pressed="showFileUploader"
          @click="showFileUploader = !showFileUploader"
        >
          <FileText /><span>文件</span
          ><span v-if="files.length + pendingUploadList.length" class="tool-count">{{
            files.length + pendingUploadList.length
          }}</span>
        </button>
      </div>
      <button
        v-if="!loading"
        class="primary-action send"
        :disabled="!canSend"
        title="发送"
        aria-label="发送消息"
        @click="sendMessage"
      >
        <ArrowUp />
      </button>
      <button
        v-else
        class="primary-action stop"
        title="取消后台任务"
        aria-label="停止生成"
        @click="emit('stop')"
      >
        <Square />
      </button>
    </div>
    <p
      v-if="statusTone === 'is-error' || hasPendingUploads"
      class="status-banner"
      :class="statusTone"
      role="status"
    >
      {{ statusText }}
    </p>
  </section>
</template>
