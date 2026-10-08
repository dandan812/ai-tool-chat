import { accountStorageKey } from '../../api/account'
import type { UploadPlan } from './file'

export const UPLOAD_SESSION_STORAGE_KEY = 'chat_upload_sessions_v1'

export interface UploadSession {
  fileId: string
  fileHash: string
  fileName: string
  fileSize: number
  totalChunks: number
  uploadedChunkIndices: number[]
  updatedAt: number
}

export function captureSessionKey(): string {
  return accountStorageKey(UPLOAD_SESSION_STORAGE_KEY)
}

// Sessions are hints for the UI, never evidence that a remote chunk exists.
export function createUploadSessions(storageKey: string) {
  function read(): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '{}')
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  function write(sessions: Record<string, unknown>) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sessions))
    } catch {
      // A full or unavailable cache must not prevent server-based resume.
    }
  }
  return {
    save(plan: UploadPlan, indices: Set<number>) {
      const session: UploadSession = {
        fileId: plan.fileId,
        fileHash: plan.fileHash,
        fileName: plan.file.name,
        fileSize: plan.file.size,
        totalChunks: plan.totalChunks,
        uploadedChunkIndices: [...indices].sort((a, b) => a - b),
        updatedAt: Date.now()
      }
      write({ ...read(), [plan.fileId]: session })
    },
    remove(fileId: string) {
      const sessions = read()
      delete sessions[fileId]
      write(sessions)
    }
  }
}
