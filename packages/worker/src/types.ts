/**
 * ==================== Agent 类型定义 ====================
 */

/** Agent 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'error'

/** Agent 步骤 */
export interface AgentStep {
  /** 步骤 ID */
  id: string
  /** Agent 思考过程 */
  thought: string
  /** 决策类型 */
  type: 'thought' | 'action' | 'result' | 'complete'
  /** 要执行的动作（Skill 名称） */
  action?: string
  /** 动作输入参数 */
  input?: any
  /** 执行结果 */
  result?: any
  /** 创建时间 */
  timestamp: number
}

/** Agent 任务 */
export interface AgentTask {
  /** 任务 ID */
  id: string
  /** 任务目标 */
  goal: string
  /** 任务状态 */
  status: TaskStatus
  /** 执行步骤 */
  steps: AgentStep[]
  /** 最终结果 */
  result?: string
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number