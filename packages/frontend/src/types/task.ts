export interface ChatMessage {
  /** Optional for older stored conversations and API callers. */
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  taskId?: string
  requestKey?: string
  sources?: EvidenceSource[]
  metrics?: TaskMetrics
  /** Local presentation only; excluded from API message history. */
  attachments?: MessageAttachment[]
  /** Distinguishes generated attachment markers from user-entered text. */
  attachmentOnly?: boolean
}

export interface MessageAttachment {
  kind: 'image' | 'file'
  name: string
  mimeType: string
  size?: number
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed'
/** mcp also labels file research tools; legacy step types remain readable. */
export type StepType = 'route' | 'skill' | 'plan' | 'mcp' | 'think' | 'respond'

export interface Task {
  id: string
  type: 'chat' | 'code' | 'image' | 'file'
  status: TaskStatus
  userMessage: string
  steps: Step[]
  /** Interrupted tasks may also retain partial results. */
  result?: string
  error?: string
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export interface Step {
  id: string
  taskId: string
  type: StepType
  status: StepStatus
  name: string
  description?: string
  /** Operation progress, not a percentage of model output tokens. */
  progress?: { message: string; current: number; total: number }
  input?: unknown
  output?: unknown
  error?: string
  startedAt?: number
  completedAt?: number
  metadata?: Record<string, unknown>
}

export interface ImageData {
  id: string
  /** Raw base64, without a data URL prefix. */
  base64: string
  mimeType: string
  description?: string
  file?: File
  /** Prepared from the draft blob for local message history only. */
  localAttachment?: MessageAttachment
}

/** Drafts retain IndexedDB references instead of base64 in component state. */
export interface DraftImage {
  id: string
  draftKey: string
  previewUrl: string
  mimeType: string
  description?: string
}

export interface UploadedFileRef {
  fileId: string
  fileName: string
  mimeType: string
  size: number
  fileHash: string
  source: 'uploaded'
}

export interface UploadProgress {
  fileId: string
  fileName: string
  uploadedChunks: number
  totalChunks: number
  percentage: number
  /** KB/s. */
  speed: number
  /** Seconds. */
  estimatedTime: number
}

export type UploadProgressCallback = (progress: UploadProgress) => void

export interface EvidenceSource {
  sourceId: string
  fileId: string
  fileName: string
  fileHash: string
  excerpt: string
  startLine: number
  endLine: number
  startOffset: number
  endOffset: number
}

export interface TaskMetrics {
  elapsedMs: number
  firstContentMs: number | null
  modelCalls: number
  inputTokens: number | null
  outputTokens: number | null
  tokenSource: 'provider' | 'estimated' | 'unknown'
  estimatedCost: number | null
  currency: string | null
  costSource: 'estimated' | 'unknown'
}
