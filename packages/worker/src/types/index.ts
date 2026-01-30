/**
 * ==================== 核心类型定义 ====================
 * Task → Step → Skill 架构
 */

// ==================== Task 任务 ====================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

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
}

export interface TaskStreamEvent {
  type: 'task' | 'step' | 'content' | 'error' | 'complete';
  taskId: string;
  data: unknown;
}

// ==================== Step 步骤 ====================

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type StepType = 'plan' | 'skill' | 'mcp' | 'think' | 'respond';

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
}

export interface StepStreamEvent {
  type: 'step_start' | 'step_progress' | 'step_complete' | 'step_error';
  step: Step;
}

// ==================== Skill 技能 ====================

export type SkillType = 'text' | 'multimodal' | 'code' | 'tool';

export interface Skill {
  name: string;
  type: SkillType;
  description: string;
  execute: (input: SkillInput, context: SkillContext) => AsyncIterable<SkillStreamChunk>;
}

export interface SkillInput {
  messages: Message[];
  images?: ImageData[];
  files?: FileData[];
  temperature?: number;
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
}

export interface ImageData {
  id: string;
  base64: string;
  mimeType: string;
  description?: string;
}

export interface FileData {
  id: string;
  name: string;
  content: string;
  mimeType: string;
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
}

// ==================== API 请求/响应 ====================

export interface ChatRequest {
  messages: Message[];
  images?: ImageData[];
  files?: FileData[];
  temperature?: number;
  stream?: boolean;
  enableTools?: boolean;
}

export interface ChatResponse {
  task: Task;
  stream?: ReadableStream;
}
