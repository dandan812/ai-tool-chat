/**
 * ==================== 核心类型定义 ====================
 * Task → Step → Skill 架构
 */

// ==================== 基础类型 ====================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';
// plan/respond 等旧类型保留，用于读取已有任务记录。
export type StepType = 'route' | 'skill' | 'plan' | 'mcp' | 'think' | 'respond';
export type SkillType = 'text' | 'multimodal' | 'code' | 'tool';
export type ToolingMode = 'disabled' | 'experimental' | 'active';

// ==================== 错误类型 ====================

export class WorkerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

export class ValidationError extends WorkerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends WorkerError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'AUTHENTICATION_ERROR', 401);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends WorkerError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class TimeoutError extends WorkerError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `${operation} timeout after ${timeoutMs}ms`,
      'TIMEOUT_ERROR',
      504
    );
    this.name = 'TimeoutError';
  }
}

export class APIError extends WorkerError {
  constructor(
    message: string,
    public provider: string,
    statusCode: number = 500
  ) {
    super(message, 'API_ERROR', statusCode, { provider });
    this.name = 'APIError';
  }
}

// ==================== Task 任务 ====================

export interface Task {
  id: string;
  type: 'chat' | 'code' | 'image' | 'file';
  status: TaskStatus;
  userMessage: string;
  steps: Step[];
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: TaskMetadata;
}

export interface TaskMetadata {
  sources?: EvidenceSource[];
  metrics?: TaskMetrics;
  model?: string;
  skill?: string;
  temperature?: number;
  tokenCount?: number;
  processingTime?: number;
  toolingMode?: ToolingMode;
  [key: string]: unknown;
}

export interface TaskStreamEvent {
  type: 'task' | 'step' | 'content' | 'error' | 'complete';
  taskId: string;
  data: unknown;
}

// ==================== Step 步骤 ====================

export interface Step {
  id: string;
  taskId: string;
  type: StepType;
  status: StepStatus;
  name: string;
  description?: string;
  progress?: ProgressInfo;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  metadata?: StepMetadata;
}

export interface StepMetadata {
  duration?: number;
  tokenCount?: number;
  [key: string]: unknown;
}

export interface StepStreamEvent {
  type: 'step_start' | 'step_progress' | 'step_complete' | 'step_error';
  step: Step;
}

// ==================== Skill 技能 ====================

export interface Skill {
  name: string;
  type: SkillType;
  description: string;
  execute: (input: SkillInput, context: SkillContext) => AsyncIterable<SkillStreamChunk>;
  supportedModels?: string[];
}

export interface SkillInput {
  messages: Message[];
  images?: ImageData[];
  files?: UploadedFileRef[];
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface SkillContext {
  taskId: string;
  stepId: string;
  env: Env;
  mcpClient: MCPClient;
}

export interface SkillStreamChunk {
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'complete' | 'progress' | 'sources' | 'usage';
  sources?: EvidenceSource[];
  usage?: ModelUsage;
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  progress?: ProgressInfo;
}

/**
 * 进度信息
 */
export interface ProgressInfo {
  message: string;
  current: number;
  total: number;
}

// ==================== 消息和多媒体 ====================

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
  timestamp?: number;
}

export interface ImageData {
  id: string;
  base64: string;
  mimeType: string;
  description?: string;
  width?: number;
  height?: number;
}

export interface UploadedFileRef {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileHash: string;
  source: 'uploaded';
}

export interface ResolvedFileContent {
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileHash: string;
  source: 'uploaded';
  content: string;
}

// ==================== 分片上传 ====================

/**
 * 分片元数据
 */
export interface ChunkMetadata {
  fileId: string;
  fileName: string;
  fileHash: string;
  totalSize: number;
  totalChunks: number;
  receivedChunks: number;
  receivedIndices: number[];
  mimeType: string;
  createdAt: number;
}

/**
 * 上传分片请求
 */
export interface UploadChunkRequest {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  fileHash: string;
  chunk: ArrayBuffer;
  mimeType: string;
}

/**
 * 上传完成请求
 */
export interface UploadCompleteRequest {
  fileId: string;
  fileHash: string;
  fileName: string;
  mimeType: string;
}

/**
 * 上传完成响应
 */
export interface UploadCompleteResponse {
  success: boolean;
  file?: UploadedFileRef;
  error?: string;
}

/**
 * 上传状态响应
 */
export interface UploadStatusResponse {
  fileId: string;
  fileName?: string;
  fileHash?: string;
  totalChunks?: number;
  receivedChunks?: number;
  receivedIndices?: number[];
  percentage?: number;
  isComplete?: boolean;
}

// ==================== MCP (Model Context Protocol) ====================

export interface MCPClient {
  tools: Map<string, MCPTool>;
  resources: Map<string, MCPResource>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  listTools: () => MCPTool[];
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ==================== 环境变量 ====================

export interface EvidenceSource {
  sourceId: string;
  fileId: string;
  fileName: string;
  fileHash: string;
  excerpt: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface ModelUsage {
  callId: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  tokenSource: 'provider' | 'estimated' | 'unknown';
  outcome: 'completed' | 'failed' | 'cancelled' | 'unknown';
}

export interface ModelRuntimeControl {
  signal: AbortSignal;
  beforeCall(input: {callId: string; model: string; estimatedInputTokens: number; maxOutputTokens: number}): Promise<void>;
  afterCall(input: ModelUsage): Promise<void>;
}

export interface TaskMetrics {
  elapsedMs: number;
  firstContentMs: number | null;
  modelCalls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  tokenSource: 'provider' | 'estimated' | 'unknown';
  estimatedCost: number | null;
  currency: string | null;
  costSource: 'estimated' | 'unknown';
}

export interface Env {
  ACCOUNTS?: DurableObjectNamespace;
  TASKS?: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  ALLOW_REGISTRATION?: string;
  ALLOW_GUEST_ACCESS?: string;
  MAX_GUEST_SESSIONS?: string;
  ENVIRONMENT?: string;
  DAILY_TOKEN_BUDGET?: string;
  TASK_TOKEN_BUDGET?: string;
  MAX_CONCURRENT_TASKS?: string;
  MAX_MODEL_CALLS?: string;
  MAX_FILE_BYTES?: string;
  MAX_USER_FILE_BYTES?: string;
  MODEL_PRICES_JSON?: string;
  MOCK_MODEL?: string;
  RUNTIME_CONTROL?: ModelRuntimeControl;
  QWEN_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  CHUNK_STORAGE: DurableObjectNamespace;
  UPLOADED_FILES: R2Bucket;
  // 可选配置
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  MAX_REQUEST_SIZE?: string;
  REQUEST_TIMEOUT?: string;
  ENABLE_CACHE?: string;
  DEFAULT_MODEL?: string;  // 默认使用的模型
  DEFAULT_FILE_MODEL?: string;  // 默认使用的文件模型
  DEFAULT_MULTIMODAL_MODEL?: string;  // 默认使用的图片模型
}

// ==================== API 请求/响应 ====================

export interface ChatRequest {
  messages: Message[];
  images?: ImageData[];
  files?: UploadedFileRef[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  enableTools?: boolean;
  model?: string;
}

export interface ChatResponse {
  task: Task;
  stream?: ReadableStream;
}

export interface StreamChunk {
  type: 'content' | 'error' | 'complete';
  content?: string;
  error?: string;
}

// ==================== 中间件 ====================

export type Handler = (request: Request, env: Env) => Promise<Response>;
export type Middleware = (handler: Handler) => Handler;

// ==================== 统计和监控 ====================

export interface TaskStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  averageProcessingTime?: number;
}

export interface ToolStats {
  calls: number;
  errors: number;
  averageTime: number;
}

// ==================== 配置 ====================

export interface WorkerConfig {
  taskTimeout: number;
  stepTimeout: number;
  maxTasks: number;
  enableCache: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const DEFAULT_CONFIG: WorkerConfig = {
  taskTimeout: 5 * 60 * 1000, // 5 分钟
  stepTimeout: 2 * 60 * 1000, // 2 分钟
  maxTasks: 100,
  enableCache: true,
  logLevel: 'info',
};
