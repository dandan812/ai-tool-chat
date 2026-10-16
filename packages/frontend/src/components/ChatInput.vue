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

import { nextTick, ref, toRefs, watch } from 'vue'
import { MAX_IMAGES } from '../config'
import type { UploadedFileRef } from '../types/task'
import ImageUploader from './ImageUploader.vue'
import FileUploader from './FileUploader.vue'
import { useChatComposer } from '../composables/useChatComposer'
import { ImagePlus, Paperclip, ArrowUp, Square, Plus } from '@lucide/vue'
import { useDetailsMenu } from '../composables/useDetailsMenu'

interface Props {
  /** 是否正在生成回复 */
  loading?: boolean
  /** 当前会话 ID */
  sessionId: string
}

const props = defineProps<Props>()
const { loading, sessionId } = toRefs(props)
const imageUploader = ref<InstanceType<typeof ImageUploader> | null>(null)
const fileUploader = ref<InstanceType<typeof FileUploader> | null>(null)
const fileUploading = ref(false)
const dragging = ref(false)
const enableTools = ref(false)
const {
  menu: attachmentMenu,
  close: closeAttachments,
  keydown: attachmentKeydown
} = useDetailsMenu()
watch(loading, (busy) => {
  if (busy) closeAttachments()
})
let dragDepth = 0

const emit = defineEmits<{
  /** 发送消息 */
  send: [
    content: string,
    images: import('../types/task').ImageData[],
    files: UploadedFileRef[],
    enableTools?: boolean
  ]
  /** 停止生成 */
  stop: []
}>()

const composer = useChatComposer({
  loading,
  sessionId,
  uploadBusy: fileUploading,
  onSend: (content, images, files) => {
    closeAttachments()
    if (enableTools.value && files.length && !images.length)
      emit('send', content, images, files, true)
    else emit('send', content, images, files)
  }
})

const {
  input,
  images,
  files,
  pendingUploadList,
  hasPendingUploads,
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
watch([() => files.value.length, () => images.value.length, sessionId], () => {
  if (!files.value.length || images.value.length) enableTools.value = false
})

async function handleImageAdd(file: File) {
  try {
    await composer.addImage(file)
  } catch (error) {
    composer.handleUploadError(error instanceof Error ? error.message : '图片处理失败')
  }
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function handleDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  if (loading.value) return
  dragDepth++
  dragging.value = true
}

function handleDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  dragging.value = dragDepth > 0
}

function handleDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = loading.value ? 'none' : 'copy'
}

function handleDrop(event: DragEvent) {
  dragDepth = 0
  dragging.value = false
  const dropped = Array.from(event.dataTransfer?.files || [])
  if (!dropped.length) return
  event.preventDefault()
  if (loading.value) return
  imageUploader.value?.addFiles(dropped.filter((file) => file.type.startsWith('image/')))
  void fileUploader.value?.addFiles(dropped.filter((file) => !file.type.startsWith('image/')))
}

function openPicker(kind: 'image' | 'file') {
  closeAttachments(true)
  if (kind === 'image') imageUploader.value?.open()
  else fileUploader.value?.open()
}

defineExpose({
  clear: clearComposer,
  async insertPrompt(value: string) {
    if (loading.value) return
    input.value = input.value ? `${input.value}\n${value}` : value
    await nextTick()
    resize()
    composer.textareaRef.value?.focus()
  }
})
</script>

<template>
  <section
    class="composer-panel"
    :class="{ loading, dragging }"
    aria-label="消息输入"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <div
      v-show="images.length || files.length || pendingUploadList.length"
      class="composer-attachments"
      aria-label="待发送附件"
    >
      <ImageUploader
        ref="imageUploader"
        :images="images"
        :max-images="MAX_IMAGES"
        :disabled="loading"
        compact
        @add="handleImageAdd"
        @remove="removeImage"
        @error="handleUploadError"
      />
      <FileUploader
        ref="fileUploader"
        :files="files"
        :disabled="loading"
        compact
        @add="addFile"
        @remove="removeFile"
        @upload-progress="handleUploadProgress"
        @upload-error="handleUploadError"
        @busy="fileUploading = $event"
      />
    </div>
    <div class="composer-body">
      <textarea
        :ref="composer.textareaRef"
        v-model="input"
        class="message-input"
        :disabled="loading"
        rows="1"
        placeholder="有什么我可以帮你的？"
        aria-label="输入问题"
        @keydown="handleKeydown"
        @input="resize"
        @paste="handlePaste"
      />
    </div>
    <div class="composer-toolbar">
      <div class="tool-group">
        <details ref="attachmentMenu" class="attachment-menu" @keydown="attachmentKeydown">
          <summary
            class="icon-button composer-tool"
            aria-label="添加附件"
            title="添加附件"
            :aria-disabled="loading"
            @click="loading && $event.preventDefault()"
          >
            <Plus />
          </summary>
          <div class="composer-menu">
            <button
              type="button"
              aria-label="添加图片"
              :disabled="loading || images.length >= MAX_IMAGES"
              @click="openPicker('image')"
            >
              <ImagePlus /><span>添加图片</span>
            </button>
            <button
              type="button"
              aria-label="添加文件"
              :disabled="loading || hasPendingUploads"
              @click="openPicker('file')"
            >
              <Paperclip /><span>添加文件</span>
            </button>
          </div>
        </details>
        <span v-if="images.length + files.length" class="composer-count sr-only">
          {{ images.length + files.length }} 个附件
        </span>
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
    <label v-if="files.length && !images.length" class="composer-research">
      <input v-model="enableTools" type="checkbox" :disabled="loading" />
      <span>资料研究</span>
    </label>
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
