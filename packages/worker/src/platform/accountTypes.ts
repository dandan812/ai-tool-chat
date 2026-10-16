import type { Env } from '../types'

export interface AccountUser {
  id: string
  username: string
  guest?: boolean
}

export type AccountSettings = Env & {
  ACCOUNTS?: DurableObjectNamespace
  ALLOW_REGISTRATION?: string
  ALLOW_GUEST_ACCESS?: string
  MAX_GUEST_SESSIONS?: string
  ENVIRONMENT?: string
  ALLOWED_ORIGINS?: string
  DAILY_TOKEN_BUDGET?: string
  MAX_CONCURRENT_TASKS?: string
  TASK_TOKEN_BUDGET?: string
  MAX_MODEL_CALLS?: string
}

export interface UserFile {
  fileId: string
  bytes: number
  fileName: string
  mimeType: string
  createdAt: number
  updatedAt: number
  status: 'uploading' | 'complete' | 'expired'
}

export interface AccountUsage {
  day: string
  chargedTokens: number
  dailyTokenBudget: number
  activeTasks: number
}

export interface ReserveTaskInput {
  userId: string
  taskId: string
  requestHash: string
  maxCalls: number
  reservedTokens: number
  maxDurationMs: number
}

export interface BeginModelCallInput {
  userId: string
  taskId: string
  callId: string
  model: string
  estimatedInputTokens: number
  maxOutputTokens: number
}

export interface SettleModelCallInput {
  userId: string
  taskId: string
  callId: string
  inputTokens?: number
  outputTokens?: number
  tokenSource: 'provider' | 'estimated' | 'unknown'
  outcome: string
}

export interface FinishTaskInput {
  userId: string
  taskId: string
  status: string
  usageUnknown: boolean
}

export interface CredentialsInput {
  username: string
  password: string
  ipHash: string
  sessionHash: string
}

export type FileOperation = 'upload' | 'complete' | 'delete'

export interface FileLeaseIdentity {
  leaseId: string
  generation: string
}

export interface AccountFileLease extends FileLeaseIdentity {
  expiresAt: number
}

export interface ReserveFileInput {
  userId: string
  fileId: string
  bytes: number
  metadata?: { externalFileId?: string; fileName?: string; mimeType?: string }
}
