import { computed, onScopeDispose, ref } from 'vue'
import { accountStorageKey } from '../../api/account'
import type { ChatMessage } from '../../types/task'
import {
  estimateStorageSize,
  generateSessionId,
  loadChatStorage,
  MAX_STORAGE_SIZE,
  pruneStoredMessages,
  saveChatStorage,
  STORAGE_SAVE_DEBOUNCE_MS,
  TITLE_MAX_LENGTH,
  type ChatSession
} from '../../stores/chatStorage'

export function createSessionRepository() {
  const restored = loadChatStorage()
  const sessionList = ref<ChatSession[]>(restored?.sessionList ?? [])
  const messagesMap = ref<Record<string, ChatMessage[]>>(restored?.messagesMap ?? {})
  const currentSessionId = ref(restored?.currentSessionId ?? '')
  const storageError = ref<string | null>(null)
  const selectionVersion = ref(0)
  const storageScope = accountStorageKey('chat_session_list')
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  function isActive() {
    return !disposed && accountStorageKey('chat_session_list') === storageScope
  }

  function cleanupOldMessages() {
    messagesMap.value = pruneStoredMessages(sessionList.value, messagesMap.value)
  }

  function flush() {
    clearTimeout(saveTimer)
    // A delayed save from a disposed account must never write into the next account.
    if (!isActive()) return
    try {
      if (estimateStorageSize(messagesMap.value) > MAX_STORAGE_SIZE) cleanupOldMessages()
      saveChatStorage(sessionList.value, messagesMap.value, currentSessionId.value)
      storageError.value = null
    } catch (error) {
      storageError.value = error instanceof Error ? error.message : '会话保存失败'
    }
  }

  function save() {
    if (!isActive()) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, STORAGE_SAVE_DEBOUNCE_MS)
  }

  function select(id: string) {
    if (!isActive()) return false
    if (!sessionList.value.some((session) => session.id === id)) return false
    selectionVersion.value++
    currentSessionId.value = id
    save()
    return true
  }

  function createSession(title?: string, initialMessages: ChatMessage[] = []) {
    const id = generateSessionId()
    const now = Date.now()
    sessionList.value.unshift({
      id,
      title: title?.trim() || '新对话',
      createdAt: now,
      updatedAt: now
    })
    messagesMap.value[id] = initialMessages.map((message) => ({
      ...message,
      id: crypto.randomUUID()
    }))
    select(id)
    return id
  }

  function deleteSession(id: string) {
    const index = sessionList.value.findIndex((session) => session.id === id)
    if (index < 0) return
    selectionVersion.value++
    sessionList.value.splice(index, 1)
    delete messagesMap.value[id]
    if (currentSessionId.value === id) {
      const next = sessionList.value[Math.min(index, sessionList.value.length - 1)]
      if (next) select(next.id)
      else createSession()
    }
    save()
  }

  function addMessage(sessionId: string, message: ChatMessage) {
    const session = sessionList.value.find((item) => item.id === sessionId)
    if (!session) return
    const items = (messagesMap.value[sessionId] ??= [])
    const id =
      message.id && !items.some((item) => item.id === message.id) ? message.id : crypto.randomUUID()
    items.push({ ...message, id })
    session.updatedAt = Date.now()
    save()
    return id
  }

  function updateSessionTitle(id: string, title: string) {
    const session = sessionList.value.find((item) => item.id === id)
    if (session && title.trim()) {
      session.title = title.trim().slice(0, TITLE_MAX_LENGTH)
      save()
    }
  }

  if (!sessionList.value.length) createSession()
  else save()
  onScopeDispose(() => {
    flush()
    disposed = true
    clearTimeout(saveTimer)
  })

  return {
    sessionList,
    messagesMap,
    currentSessionId,
    selectionVersion,
    storageError,
    sessions: computed(() => sessionList.value),
    currentSession: computed(() =>
      sessionList.value.find((session) => session.id === currentSessionId.value)
    ),
    messages: computed(() => messagesMap.value[currentSessionId.value] ?? []),
    createSession,
    select,
    deleteSession,
    addMessage,
    updateSessionTitle,
    cleanupOldMessages,
    save,
    flush,
    isActive
  }
}

export type SessionRepository = ReturnType<typeof createSessionRepository>
