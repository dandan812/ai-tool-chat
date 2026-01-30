/**
 * ID 生成工具
 */

/**
 * 生成唯一 ID
 * 格式: timestamp-random
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}

/**
 * 生成 Task ID
 */
export function generateTaskId(): string {
  return `task-${generateId()}`;
}

/**
 * 生成 Step ID
 */
export function generateStepId(): string {
  return `step-${generateId()}`;
}
