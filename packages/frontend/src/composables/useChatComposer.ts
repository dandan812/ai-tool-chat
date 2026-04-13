import { computed, onMounted, ref, type Ref, watch } from 'vue'
import type { DraftImage, ImageData, UploadedFileRef, UploadProgress } from '../types/task'
import { useAutoResize } from './useAutoResize'
import { isSupportedTextFile } from '../utils/file'
import { uploadChunkedFile } from '../utils/chunk'
import {
  clearDraftImages,
  loadDraftImages,
  removeDraftImage,
  resolveDraftImage,
  revokeDraftPreviews,
  saveDraftImage,
  syncDraftImageRefs,
} from '../utils/draftImageStore'

interface UseChatComposerOptions {
  /** 加载状态 */
  loading: Readonly<Ref<boolean | undefined>>
  /** 当前会话 ID */
  sessionId: Readonly<Ref<string>>
  /** 发送消息回调 */
  onSend: (content: string, images: ImageData[], files: UploadedFileRef[]) => void
}

/**
 * 管理聊天输入区的状态与交互。
 * 组件层只保留模板和展示，脚本逻辑集中在这里。
 */
export function useChatComposer(options: UseChatComposerOptions) {
  const input = ref('')
  const images = ref<DraftImage[]>([])
  const files = ref<UploadedFileRef[]>([])
  const showImageUploader = ref(false)
  const showFileUploader = ref(false)
  const uploadError = ref('')
  const pendingUploads = ref<Record<string, UploadProgress>>({})

  const { textareaRef, resize, reset } = useAutoResize()

  function persistDraftImages() {
    if (!options.sessionId.value) return
    syncDraftImageRefs(options.sessionId.value, images.value)
  }

  const hasPendingUploads = computed(() => Object.keys(pendingUploads.value).length > 0)
  const pendingUploadList = computed(() => Object.values(pendingUploads.value))
  const hasAttachments = computed(() => images.value.length > 0 || files.value.length > 0)

  const showAttachmentTray = computed(() => {
    return (
      showImageUploader.value ||
      showFileUploader.value ||
      images.value.length > 0 ||
      files.value.length > 0 ||
      hasPendingUploads.value
    )
  })

  const canSend = computed(() => {
    return (
      (input.value.trim() || hasAttachments.value) &&
      !options.loading.value &&
      !hasPendingUploads.value
    )
  })

  const statusText = computed(() => {
    if (hasPendingUploads.value) {
      return '文件仍在上传，完成后再发送会更稳定。'
    }

    if (uploadError.value) {
      return uploadError.value
    }

    if (options.loading.value) {
      return '模型正在生成内容，可随时停止。'
    }

    if (hasAttachments.value) {
      return `已准备 ${images.value.length} 张图片、${files.value.length} 个文件引用。`
    }

    return 'Enter 发送，Shift + Enter 换行。'
  })

  const statusTone = computed(() => {
    if (uploadError.value) return 'is-error'
    if (hasPendingUploads.value) return 'is-busy'
    if (options.loading.value) return 'is-streaming'
    return 'is-idle'
  })

  async function clearComposer() {
    input.value = ''
    const currentImages = [...images.value]
    images.value = []
    files.value = []
    showImageUploader.value = false
    showFileUploader.value = false
    uploadError.value = ''
    pendingUploads.value = {}
    reset()
    await clearDraftImages(currentImages)
    if (options.sessionId.value) {
      syncDraftImageRefs(options.sessionId.value, [])
    }
  }

  async function handlePasteImage(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (!item.type.startsWith('image/')) continue

      const file = item.getAsFile()
      if (!file) continue

      try {
        await addImage(file)
        showImageUploader.value = true
      } catch (error) {
        console.error('Failed to paste image:', error)
      }
    }
  }

  async function handlePasteFile(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
      const file = item.getAsFile()
      if (!file || !isSupportedTextFile(file)) continue

      try {
        showFileUploader.value = true
        const uploadedFile = await uploadTextFile(file)
        addFile(uploadedFile)
      } catch (error) {
        console.error('Failed to paste file:', error)
        uploadError.value = error instanceof Error ? error.message : '粘贴文件失败'
      }
    }
  }

  async function addImage(file: File) {
    const image = await saveDraftImage(file)
    images.value.push(image)
    persistDraftImages()
  }

  async function removeImage(id: string) {
    const image = images.value.find((item) => item.id === id)
    images.value = images.value.filter((item) => item.id !== id)
    if (image) {
      await removeDraftImage(image.draftKey, image.previewUrl)
    }
    persistDraftImages()
  }

  function addFile(file: UploadedFileRef) {
    files.value.push(file)
    uploadError.value = ''
    clearPendingUpload(file.fileId)
  }

  function removeFile(id: string) {
    files.value = files.value.filter((file) => file.fileId !== id)
    clearPendingUpload(id)
  }

  function clearPendingUpload(fileId: string) {
    delete pendingUploads.value[fileId]
  }

  function handleUploadProgress(progress: UploadProgress) {
    pendingUploads.value[progress.fileId] = progress
  }

  function handleUploadError(message: string) {
    uploadError.value = message
    pendingUploads.value = {}
  }

  async function uploadTextFile(file: File): Promise<UploadedFileRef> {
    uploadError.value = ''

    return uploadChunkedFile(file, {
      onProgress: handleUploadProgress,
    })
  }

  async function sendMessage() {
    if (!canSend.value) return

    try {
      const resolvedImages = await Promise.all(images.value.map((image) => resolveDraftImage(image)))
      options.onSend(input.value.trim(), resolvedImages, files.value)
      await clearComposer()
    } catch (error) {
      uploadError.value = error instanceof Error ? error.message : '图片处理失败'
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  async function handlePaste(event: ClipboardEvent) {
    await handlePasteImage(event)
    await handlePasteFile(event)
  }

  async function restoreDraftImages(sessionId: string) {
    revokeDraftPreviews(images.value)
    images.value = sessionId ? await loadDraftImages(sessionId) : []
  }

  watch(
    () => options.sessionId.value,
    (sessionId) => {
      void restoreDraftImages(sessionId)
    },
    { immediate: true },
  )

  onMounted(() => {
    if (options.sessionId.value) {
      void restoreDraftImages(options.sessionId.value)
    }
  })

  return {
    input,
    images,
    files,
    showImageUploader,
    showFileUploader,
    uploadError,
    pendingUploadList,
    hasPendingUploads,
    hasAttachments,
    showAttachmentTray,
    canSend,
    statusText,
    statusTone,
    textareaRef,
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
  }
}
