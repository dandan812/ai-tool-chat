import { defineStore } from 'pinia'
import { computed } from 'vue'
import { createSessionRepository } from '../features/chat/sessionRepository'
import { createSessionTasks } from '../features/tasks/sessionTasks'

// Component-facing names stay stable; persistence and observation have separate owners.
export const useChatStore = defineStore('chat', () => {
  const sessions = createSessionRepository()
  const tasks = createSessionTasks(sessions)
  const storageError = computed({
    get: () => tasks.error.value ?? sessions.storageError.value,
    set: (value: string | null) => {
      tasks.error.value = null
      sessions.storageError.value = value
    }
  })

  function switchSession(id: string) {
    const selected = sessions.select(id)
    if (selected) tasks.clearStreamingContent()
    return selected
  }

  function deleteSession(id: string) {
    if (!sessions.sessionList.value.some((session) => session.id === id)) return
    tasks.forgetSession(id)
    sessions.deleteSession(id)
  }

  function deleteMessage(index: number) {
    const sessionId = sessions.currentSessionId.value
    const items = sessions.messagesMap.value[sessionId]
    if (!items || !Number.isInteger(index) || index < 0 || index >= items.length) return
    const removed = items.splice(index, 1)[0]
    if (tasks.isObservedMessage(sessionId, removed?.id)) {
      tasks.stopObservation(sessionId)
    }
    sessions.save()
  }

  function clearChat() {
    const sessionId = sessions.currentSessionId.value
    if (!sessionId) return
    tasks.forgetSession(sessionId)
    sessions.selectionVersion.value++
    sessions.messagesMap.value[sessionId] = []
    sessions.save()
  }

  return {
    sessions: sessions.sessions,
    currentSession: sessions.currentSession,
    messages: sessions.messages,
    messagesMap: sessions.messagesMap,
    currentSessionId: sessions.currentSessionId,
    storageError,
    createSession: sessions.createSession,
    addMessage: sessions.addMessage,
    cleanupOldMessages: sessions.cleanupOldMessages,
    switchSession,
    deleteSession,
    deleteMessage,
    clearChat,
    streamingContent: tasks.streamingContent,
    isLoading: tasks.isLoading,
    sendTaskMessage: tasks.sendTaskMessage,
    stopGeneration: tasks.stopGeneration,
    stopViewing: tasks.stopViewing,
    restoreTask: tasks.restoreTask,
    restoreActiveTask: tasks.restoreActiveTask,
    resetTransientState: tasks.resetTransientState,
    setStreamingContent: tasks.setStreamingContent,
    clearStreamingContent: tasks.clearStreamingContent,
    getMessageContent: tasks.getMessageContent,
    setSessionLoading: tasks.setSessionLoading,
    isSessionLoading: tasks.isSessionLoading,
    getCurrentTask: tasks.getCurrentTask,
    getSteps: tasks.getSteps
  }
})
