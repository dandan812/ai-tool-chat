import { computed, ref, type Ref } from 'vue'
import type { ImageData, UploadedFileRef, UploadProgress } from '../types/task'
import { useAutoResize } from './useAutoResize'
import { fileToImageData } from '../utils/image'
import { isSupportedTextFile } from '../utils/file'
import { uploadChunkedFile } from '../utils/chunk'

interface UseChatComposerOptions {
  /** 加载状态 */
  loading: Readonly<Ref<boolean | undefined>>
  /** 发送消息回调 */
  onSend: (content: string, images: ImageData[], files: UploadedFileRef[]) => void
}

/**
 * 管理聊天输入区的状态与交互。
 * 组件层只保留模板和展示，脚本逻辑集中在这里。
 */
export function useChatComposer(options: UseChatComposerOptions) {
  const input = ref('')
  const images = ref<ImageData[]>([])
  const files = ref<UploadedFileRef[]>([])
  const showImageUploader = ref(false)
  const showFileUploader = ref(false)
  const uploadError = ref('')
  const pendingUploads = ref<Record<string, UploadProgress>>({})

  const { textareaRef, resize, reset } = useAutoResize()

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

  function clearComposer() {
    input.value = ''
    images.value = []
    files.value = []
    showImageUploader.value = false
    showFileUploader.value = false
    uploadError.value = ''
    pendingUploads.value = {}
    reset()
  }

  async function handlePasteImage(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (!item.type.startsWith('image/')) continue

      const file = item.getAsFile()
      if (!file) continue

      try {
        const imageData = await fileToImageData(file)
        addImage(imageData)
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

  function addImage(image: ImageData) {
    images.value.push(image)
  }

  function removeImage(id: string) {
    images.value = images.value.filter((image) => image.id !== id)
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
    const nextPendingUploads = { ...pendingUploads.value }
    delete nextPendingUploads[fileId]
    pendingUploads.value = nextPendingUploads
  }

  function handleUploadProgress(progress: UploadProgress) {
    pendingUploads.value = {
      ...pendingUploads.value,
      [progress.fileId]: progress,
    }
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

  function sendMessage() {
    if (!canSend.value) return

    options.onSend(input.value.trim(), images.value, files.value)
    clearComposer()
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
