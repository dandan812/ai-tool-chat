import type { ChatMessage, ImageData } from '../types/task'

export function buildHistoryMessages(
  messages: ChatMessage[]
): Array<Pick<ChatMessage, 'role' | 'content'>> {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }))
}

export function buildRequestMessages(
  messages: ChatMessage[],
  userMessage: ChatMessage
): Array<Pick<ChatMessage, 'role' | 'content'>> {
  return [
    ...buildHistoryMessages(messages),
    { role: userMessage.role, content: userMessage.content }
  ]
}

export function buildRequestImages(images: ImageData[]): ImageData[] {
  return images.map((image) => ({
    id: image.id,
    base64: image.base64,
    mimeType: image.mimeType,
    ...(image.description === undefined ? {} : { description: image.description })
  }))
}
