/**
 * Task/Step 类型定义
 * 对应 Worker 后端的架构
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

// ==================== SSE 事件 ====================

export type SSEEventType = 'task' | 'step' | 'content' | 'error' | 'complete';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

export interface TaskEvent {
  task: Task;
  event: 'started' | 'updated' | 'completed' | 'failed';
}

export interface StepEvent {
  step: Step;
  event: 'start' | 'progress' | 'complete' | 'error';
}

export interface ContentEvent {
  content: string;
}

export interface ErrorEvent {
  error: string;
  task?: Task;
}

// ==================== 多模态 ====================

export interface ImageData {
  id: string;
  base64: string;
  mimeType: string;
  description?: string;
  file?: File;
}

// ==================== 工具调用 ====================

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
