import type { ChatMessage, ImageData, UploadedFileRef } from '../types/task'

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface StorageData {
  sessionList: ChatSession[]
  messagesMap: Record<string, ChatMessage[]>
  currentSessionId: string
}

export const STORAGE_KEYS = {
  SESSION_LIST: 'chat_session_list',
  MESSAGES_MAP: 'chat_messages_map',
  CURRENT_SESSION_ID: 'chat_current_session_id'
} as const

export const STORAGE_VERSION = 'v1'
export const MAX_STORAGE_SIZE = 4 * 1024 * 1024
export const TITLE_MAX_LENGTH = 50
export const STORAGE_SAVE_DEBOUNCE_MS = 300

export function generateSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function estimateStorageSize(data: unknown): number {
  return new Blob([JSON.stringify(data)]).size
}

export function generateFallbackTitle(content: string): string {
  return content.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX_LENGTH) || '新对话'
}

export function buildUserMessageContent(content: string, images: ImageData[], files: UploadedFileRef[]): string {
  const trimmed = content.trim()
  if (trimmed) return trimmed
  if (images.length > 0) return '[图片]'
  if (files.length > 0) return `[文件: ${files.map((file) => file.fileName).join(', ')}]`
  return ''
}

export function pruneStoredMessages(
  sessionList: ChatSession[],
  messagesMap: Record<string, ChatMessage[]>,
): Record<string, ChatMessage[]> {
  if (sessionList.length <= 3) return messagesMap

  const recentIds = new Set(sessionList.slice(0, 3).map((session) => session.id))
  const nextMessagesMap: Record<string, ChatMessage[]> = {}

  for (const [id, sessionMessages] of Object.entries(messagesMap)) {
    nextMessagesMap[id] = recentIds.has(id) ? sessionMessages : sessionMessages.slice(-10)
  }

  return nextMessagesMap
}

export function loadChatStorage(): StorageData | null {
  try {
    const sessionListData = localStorage.getItem(STORAGE_KEYS.SESSION_LIST)
    const messagesMapData = localStorage.getItem(STORAGE_KEYS.MESSAGES_MAP)
    const currentId = localStorage.getItem(STORAGE_KEYS.CURRENT_SESSION_ID)

    if (!sessionListData || !messagesMapData) return null

    const sessionList: ChatSession[] = JSON.parse(sessionListData)
    const messagesMap: Record<string, ChatMessage[]> = JSON.parse(messagesMapData)

    if (!Array.isArray(sessionList)) return null

    return {
      sessionList,
      messagesMap,
      currentSessionId: currentId ?? sessionList[0]?.id ?? ''
    }
  } catch (error) {
    console.error('Storage load failed:', error)
    return null
  }
}

export function saveChatStorage(
  sessionList: ChatSession[],
  messagesMap: Record<string, ChatMessage[]>,
  currentSessionId: string,
): void {
  localStorage.setItem(STORAGE_KEYS.SESSION_LIST, JSON.stringify(sessionList))
  localStorage.setItem(STORAGE_KEYS.MESSAGES_MAP, JSON.stringify(messagesMap))
  localStorage.setItem(STORAGE_KEYS.CURRENT_SESSION_ID, currentSessionId)
}
