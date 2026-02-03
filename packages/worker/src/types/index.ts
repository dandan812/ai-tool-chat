/**
 * ==================== 核心类型定义 ====================
 * Task → Step → Skill 架构
 */

// ==================== 基础类型 ====================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepType = 'plan' | 'skill' | 'mcp' | 'think' | 'respond';
export type SkillType = 'text' | 'multimodal' | 'code' | 'tool';

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
  model?: string;
  temperature?: number;
  tokenCount?: number;
  processingTime?: number;
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
  files?: FileData[];
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
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'complete';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
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

export interface FileData {
  id: string;
  name: string;
  content: string;
  mimeType: string;
  size?: number;
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

export interface Env {
  DEEPSEEK_API_KEY: string;
  QWEN_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  // 可选配置
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  MAX_REQUEST_SIZE?: string;
  REQUEST_TIMEOUT?: string;
  ENABLE_CACHE?: string;
}

// ==================== API 请求/响应 ====================

export interface ChatRequest {
  messages: Message[];
  images?: ImageData[];
  files?: FileData[];
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
