import { computed, onScopeDispose, ref, type Ref, watch } from 'vue'
import { MAX_IMAGES } from '../config'
import type { DraftImage, ImageData, UploadedFileRef, UploadProgress } from '../types/task'
import { useAutoResize } from './useAutoResize'
import { designPixels } from '../utils/designTokens'
import { isSupportedUploadFile } from '../utils/file'
import { uploadChunkedFile } from '../utils/chunk'
import {
  clearDraftImages,
  loadDraftImages,
  removeDraftImage,
  resolveDraftImage,
  revokeDraftPreviews,
  saveDraftImage,
  syncDraftImageRefs
} from '../utils/draftImageStore'

interface UseChatComposerOptions {
  /** 加载状态 */
  loading: Readonly<Ref<boolean | undefined>>
  /** 当前会话 ID */
  sessionId: Readonly<Ref<string>>
  uploadBusy?: Readonly<Ref<boolean>>
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
  const pendingImages = ref(0)
  const pastingFiles = ref(false)
  const sending = ref(false)
  let revision = 0
  let disposed = false

  const maxHeight = designPixels('--composer-max-height')
  const { textareaRef, resize, reset } = useAutoResize(
    maxHeight ? { maxHeight, minHeight: designPixels('--composer-min-height') } : {}
  )

  function persistDraftImages() {
    if (!options.sessionId.value) return
    syncDraftImageRefs(options.sessionId.value, images.value)
  }

  const hasPendingUploads = computed(
    () =>
      options.uploadBusy?.value ||
      pastingFiles.value ||
      Object.keys(pendingUploads.value).length > 0 ||
      pendingImages.value > 0
  )
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
      !sending.value &&
      !hasPendingUploads.value
    )
  })

  const statusText = computed(() => {
    if (hasPendingUploads.value) {
      return pendingImages.value > 0 ? '图片处理中…' : '文件上传中…'
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
    revision++
    input.value = ''
    const currentImages = [...images.value]
    images.value = []
    files.value = []
    showImageUploader.value = false
    showFileUploader.value = false
    uploadError.value = ''
    pendingUploads.value = {}
    pendingImages.value = 0
    pastingFiles.value = false
    reset()
    if (options.sessionId.value) {
      syncDraftImageRefs(options.sessionId.value, [])
    }
    await clearDraftImages(currentImages)
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
    if (disposed || options.loading.value || sending.value || hasPendingUploads.value) return
    const items = event.clipboardData?.items
    if (!items) return

    const startedAt = revision
    pastingFiles.value = true
    let batchError = ''
    try {
      for (const item of items) {
        if (disposed || startedAt !== revision || options.loading.value || sending.value) break
        const file = item.getAsFile()
        if (!file || file.type.startsWith('image/')) continue
        if (!isSupportedUploadFile(file)) {
          batchError = `不支持的文件类型：${file.name}`
          handleUploadError(batchError)
          continue
        }

        try {
          showFileUploader.value = true
          const uploadedFile = await uploadFile(file, startedAt)
          if (disposed || startedAt !== revision) break
          addFile(uploadedFile)
        } catch (error) {
          if (disposed || startedAt !== revision) break
          batchError = error instanceof Error ? error.message : '粘贴文件失败'
          handleUploadError(batchError)
        }
      }
    } finally {
      if (startedAt === revision) {
        pastingFiles.value = false
        if (batchError) uploadError.value = batchError
      }
    }
  }

  async function addImage(file: File) {
    if (images.value.length + pendingImages.value >= MAX_IMAGES)
      throw new Error(`最多选择 ${MAX_IMAGES} 张图片`)
    uploadError.value = ''
    const startedAt = revision
    pendingImages.value++
    try {
      const image = await saveDraftImage(file)
      if (startedAt !== revision) {
        await removeDraftImage(image.draftKey, image.previewUrl)
        return
      }
      images.value.push(image)
      persistDraftImages()
    } finally {
      if (startedAt === revision) pendingImages.value--
    }
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

  async function uploadFile(file: File, startedAt: number): Promise<UploadedFileRef> {
    uploadError.value = ''

    return uploadChunkedFile(file, {
      onProgress: (progress) => {
        if (!disposed && startedAt === revision) handleUploadProgress(progress)
      }
    })
  }

  async function sendMessage() {
    if (!canSend.value) return
    sending.value = true
    const startedAt = revision
    try {
      const resolvedImages = await Promise.all(
        images.value.map((image) => resolveDraftImage(image))
      )
      if (startedAt !== revision) return
      options.onSend(input.value.trim(), resolvedImages, files.value)
      await clearComposer()
    } catch (error) {
      uploadError.value = error instanceof Error ? error.message : '图片处理失败'
    } finally {
      sending.value = false
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault()
      sendMessage()
    }
  }

  async function handlePaste(event: ClipboardEvent) {
    if (disposed || options.loading.value || sending.value || hasPendingUploads.value) return
    const startedAt = revision
    await handlePasteImage(event)
    if (disposed || startedAt !== revision) return
    await handlePasteFile(event)
  }

  async function restoreDraftImages(sessionId: string) {
    const startedAt = ++revision
    pendingImages.value = 0
    pastingFiles.value = false
    pendingUploads.value = {}
    revokeDraftPreviews(images.value)
    images.value = []
    const restored = sessionId ? await loadDraftImages(sessionId) : []
    if (startedAt !== revision) {
      revokeDraftPreviews(restored)
      return
    }
    images.value = restored
  }

  watch(
    () => options.sessionId.value,
    (sessionId) => {
      void restoreDraftImages(sessionId)
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    disposed = true
    revision++
    revokeDraftPreviews(images.value)
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
    clearComposer
  }
}
