import type { ImageData, MessageAttachment, UploadedFileRef } from '../types/task'

export const MAX_MESSAGE_ATTACHMENTS = 64
export const MAX_ATTACHMENT_NAME_LENGTH = 256
const MAX_MIME_TYPE_LENGTH = 128

/** Whitelist restored metadata; URLs, blobs and image content are never retained. */
export function normalizeMessageAttachments(value: unknown): MessageAttachment[] {
  if (!Array.isArray(value)) return []

  return value.slice(0, MAX_MESSAGE_ATTACHMENTS).flatMap((item) => {
    if (!item || typeof item !== 'object' || (item.kind !== 'image' && item.kind !== 'file')) {
      return []
    }
    const name =
      typeof item.name === 'string'
        ? item.name
            .slice(0, MAX_ATTACHMENT_NAME_LENGTH)
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
        : ''
    const mimeType =
      typeof item.mimeType === 'string' &&
      item.mimeType.length <= MAX_MIME_TYPE_LENGTH &&
      /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(item.mimeType)
        ? item.mimeType.toLowerCase()
        : ''
    const size =
      typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size >= 0
        ? item.size
        : undefined

    return [
      {
        kind: item.kind as MessageAttachment['kind'],
        name: name || (item.kind === 'image' ? '图片' : '文件'),
        mimeType,
        ...(size === undefined ? {} : { size })
      }
    ]
  })
}

export function buildMessageAttachments(
  images: ImageData[],
  files: UploadedFileRef[]
): MessageAttachment[] {
  return normalizeMessageAttachments([
    ...images.map((image) => ({
      kind: 'image',
      name: image.localAttachment?.name || image.file?.name || image.description || '图片',
      mimeType: image.mimeType,
      size: image.localAttachment?.size ?? image.file?.size
    })),
    ...files.map((file) => ({
      kind: 'file',
      name: file.fileName,
      mimeType: file.mimeType,
      size: file.size
    }))
  ])
}

export function presentMessageAttachment(attachment: MessageAttachment): string {
  const extension = attachment.name.split('.').pop() || ''
  const type =
    attachment.name.includes('.') && /^[a-z0-9]{1,12}$/i.test(extension)
      ? extension.toUpperCase()
      : attachment.kind === 'image'
        ? '图片'
        : '文件'
  if (attachment.size === undefined) return type

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const unit =
    attachment.size === 0
      ? 0
      : Math.min(Math.floor(Math.log(attachment.size) / Math.log(1024)), units.length - 1)
  const size = Number((attachment.size / 1024 ** unit).toFixed(1))
  return `${type} · ${size} ${units[unit]}`
}
