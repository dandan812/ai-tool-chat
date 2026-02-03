/**
 * ID 和时间工具
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
 * 生成 ULID (Universally Unique Lexicographically Sortable Identifier)
 * 格式: 时间戳(10字符) + 随机(16字符)
 */
export function generateULID(): string {
  const time = Date.now().toString(32).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => 
    Math.floor(Math.random() * 36).toString(36)
  ).join('');
  return time + random;
}

/**
 * 生成短 ID (8字符)
 */
export function generateShortId(): string {
  return Math.random().toString(36).substring(2, 10);
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

/**
 * 格式化时间为 ISO 8601
 */
export function formatISO(date = new Date()): string {
  return date.toISOString();
}

/**
 * 获取当前时间戳
 */
export function now(): number {
  return Date.now();
}
