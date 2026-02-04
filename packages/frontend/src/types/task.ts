/**
 * Task/Step 类型定义
 *
 * 这个文件定义了与 Worker 后端通信相关的所有类型。
 * 后端采用 Task → Step → Skill 架构模式。
 *
 * 架构说明：
 * - Task：表示单个聊天请求，管理整个任务的生命周期
 * - Steps：任务执行的顺序阶段（plan → skill → respond）
 * - Skills：可插拔的处理模块（textSkill、multimodalSkill 等）
 *
 * @package frontend/src/types
 */

// ==================== Task 任务类型 ====================

/**
 * 任务状态枚举
 * 表示任务在执行过程中的不同阶段
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Task 任务接口
 *
 * 代表一个完整的用户请求处理过程
 * 例如：用户发送一条消息 → AI 分析 → AI 调用工具 → AI 生成回复
 *
 * @property id - 任务唯一标识符
 * @property type - 任务类型（chat/code/image/file）
 * @property status - 任务当前状态
 * @property userMessage - 用户的原始输入内容
 * @property steps - 任务包含的所有步骤
 * @property result - 任务执行结果（成功时）
 * @property error - 错误信息（失败时）
 * @property createdAt - 任务创建时间戳
 * @property updatedAt - 任务最后更新时间戳
 */
export interface Task {
  /** 任务唯一 ID */
  id: string;
  /** 任务类型，决定使用哪种 Skill 处理 */
  type: 'chat' | 'code' | 'image' | 'file';
  /** 任务当前状态 */
  status: TaskStatus;
  /** 用户的原始输入内容 */
  userMessage: string;
  /** 任务包含的所有步骤列表 */
  steps: Step[];
  /** 任务执行结果（仅 status 为 completed 时有值） */
  result?: string;
  /** 错误信息（仅 status 为 failed 时有值） */
  error?: string;
  /** 任务创建时间戳（毫秒） */
  createdAt: number;
  /** 任务最后更新时间戳（毫秒） */
  updatedAt: number;
}

// ==================== Step 步骤类型 ====================

/**
 * 步骤状态枚举
 * 表示步骤在执行过程中的不同阶段
 */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 步骤类型枚举
 * 定义了所有可能的步骤类型，对应任务执行的不同阶段
 *
 * - plan：分析用户输入，制定执行计划
 * - skill：调用具体的 AI 模型
 * - mcp：执行模型上下文协议（MCP）工具
 * - think：内部思考过程（可选）
 * - respond：生成最终响应内容
 */
export type StepType = 'plan' | 'skill' | 'mcp' | 'think' | 'respond';

/**
 * Step 步骤接口
 *
 * 表示任务执行过程中的一个具体步骤
 * 每个步骤都有自己的状态、输入输出和执行时间
 *
 * @property id - 步骤唯一标识符
 * @property taskId - 所属任务的 ID
 * @property type - 步骤类型
 * @property status - 步骤当前状态
 * @property name - 步骤显示名称
 * @property description - 步骤详细描述
 * @property input - 步骤输入数据（可以是任何类型）
 * @property output - 步骤输出数据（可以是任何类型）
 * @property error - 错误信息（仅 status 为 failed 时有值）
 * @property startedAt - 步骤开始时间戳
 * @property completedAt - 步骤完成时间戳
 */
export interface Step {
  /** 步骤唯一 ID */
  id: string;
  /** 所属任务的 ID */
  taskId: string;
  /** 步骤类型 */
  type: StepType;
  /** 步骤当前状态 */
  status: StepStatus;
  /** 步骤显示名称（用于 UI） */
  name: string;
  /** 步骤详细描述（可选） */
  description?: string;
  /** 步骤输入数据（类型取决于 step type） */
  input?: unknown;
  /**
   * 步骤输出数据
   * 对于 skill 步骤，可能包含 { model: 'deepseek-chat', ... }
   */
  output?: unknown;
  /** 错误信息（仅 status 为 failed 时有值） */
  error?: string;
  /** 步骤开始时间戳（毫秒） */
  startedAt?: number;
  /** 步骤完成时间戳（毫秒） */
  completedAt?: number;
}

// ==================== SSE 事件类型 ====================

/**
 * SSE（Server-Sent Events）事件类型枚举
 * 定义了后端可以通过 SSE 推送的所有事件类型
 */
export type SSEEventType = 'task' | 'step' | 'content' | 'error' | 'complete';

/**
 * SSE 事件基础接口
 *
 * 所有 SSE 事件的通用结构
 * @property type - 事件类型
 * @property data - 事件携带的数据（根据 type 不同而有不同结构）
 */
export interface SSEEvent {
  /** 事件类型 */
  type: SSEEventType;
  /** 事件数据（根据 type 不同而有不同结构） */
  data: unknown;
}

/**
 * Task 事件数据
 * 当 SSE 事件 type 为 'task' 时，data 的结构
 *
 * @property task - 任务对象
 * @property event - 具体的任务事件类型
 */
export interface TaskEvent {
  /** 完整的任务对象 */
  task: Task;
  /** 任务事件类型 */
  event: 'started' | 'updated' | 'completed' | 'failed';
}

/**
 * Step 事件数据
 * 当 SSE 事件 type 为 'step' 时，data 的结构
 *
 * @property step - 步骤对象
 * @property event - 具体的步骤事件类型
 */
export interface StepEvent {
  /** 完整的步骤对象 */
  step: Step;
  /** 步骤事件类型 */
  event: 'start' | 'progress' | 'complete' | 'error';
}

/**
 * Content 事件数据
 * 当 SSE 事件 type 为 'content' 时，data 的结构
 *
 * 用于流式传输 AI 生成的内容
 * @property content - 内容片段
 */
export interface ContentEvent {
  /** 内容片段（字符串） */
  content: string;
}

/**
 * Error 事件数据
 * 当 SSE 事件 type 为 'error' 时，data 的结构
 *
 * @property error - 错误信息
 * @property task - 相关的任务对象（可选）
 */
export interface ErrorEvent {
  /** 错误信息字符串 */
  error: string;
  /** 相关的任务对象（可选） */
  task?: Task;
}

// ==================== 多模态数据类型 ====================

/**
 * 图片数据接口
 *
 * 用于表示用户上传的图片信息
 * 图片转换为 base64 格式传输
 *
 * @property id - 图片唯一 ID
 * @property base64 - Base64 编码的图片数据（不含前缀）
 * @property mimeType - 图片 MIME 类型（如 image/jpeg）
 * @property description - 图片描述（可选）
 * @property file - 原始 File 对象（可选）
 */
export interface ImageData {
  /** 图片唯一 ID */
  id: string;
  /** Base64 编码的图片数据（不含 data:image/xxx;base64, 前缀） */
  base64: string;
  /** 图片 MIME 类型 */
  mimeType: string;
  /** 图片描述文本（可选） */
  description?: string;
  /** 原始 File 对象（可选） */
  file?: File;
}

// ==================== 文件上传类型 ====================

/**
 * 文件数据接口
 *
 * 用于表示用户上传的文本文件信息
 * 文件内容以纯文本形式传输
 *
 * @property id - 文件唯一 ID
 * @property name - 文件名
 * @property content - 文件内容（纯文本）
 * @property mimeType - 文件 MIME 类型
 * @property size - 文件大小（字节）
 * @property file - 原始 File 对象（可选）
 */
export interface FileData {
  /** 文件唯一 ID */
  id: string;
  /** 文件名 */
  name: string;
  /** 文件内容（纯文本） */
  content: string;
  /** 文件 MIME 类型 */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 原始 File 对象（可选） */
  file?: File;
}

// ==================== 工具调用类型 ====================

/**
 * 工具调用接口
 *
 * 用于表示 AI 模型调用的工具
 * MCP（Model Context Protocol）工具调用
 *
 * @property id - 调用唯一 ID
 * @property name - 工具名称
 * @property arguments - 工具参数
 */
export interface ToolCall {
  /** 调用唯一 ID */
  id: string;
  /** 工具名称 */
  name: string;
  /** 工具参数（键值对） */
  arguments: Record<string, unknown>;
}

/**
 * 工具执行结果接口
 *
 * 用于表示工具调用的返回结果
 *
 * @property toolCallId - 对应的工具调用 ID
 * @property content - 执行结果内容
 * @property isError - 是否为错误结果
 */
export interface ToolResult {
  /** 对应的工具调用 ID */
  toolCallId: string;
  /** 执行结果内容 */
  content: string;
  /** 是否为错误结果 */
  isError?: boolean;
}
