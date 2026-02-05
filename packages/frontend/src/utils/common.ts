/**
 * 通用工具函数库
 *
 * 提供项目中常用的工具函数，避免代码重复
 *
 * @package frontend/src/utils
 */

import {
  generateId,
  formatFileSize,
  IMAGE_CACHE_SIZE,
  IMAGE_COMPRESSION
} from '../config'

/**
 * 导出从 config 导入的函数和常量
 * 方便统一使用 common.ts 作为工具函数入口
 */
export { generateId, formatFileSize, IMAGE_CACHE_SIZE, IMAGE_COMPRESSION }

// ==================== 类型守卫 ====================

/**
 * 检查值是否为非空对象
 */
export function isNonEmptyObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0
}

/**
 * 检查值是否为非空字符串
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * 检查值是否为数字
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value)
}

/**
 * 检查 Promise 结果是否成功
 */
export function isPromiseFulfilled<T>(
  result: PromiseSettledResult<T>
): result is PromiseFulfilledResult<T> {
  return result.status === 'fulfilled'
}

// ==================== 字符串处理 ====================

/**
 * 截断字符串，添加省略号
 * @param str 原始字符串
 * @param maxLength 最大长度
 * @param suffix 后缀（默认为 "..."）
 */
export function truncateString(
  str: string,
  maxLength: number,
  suffix = '...'
): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - suffix.length) + suffix
}

/**
 * 移除字符串两端的空白字符
 */
export function trim(str: string): string {
  return str.trim()
}

/**
 * 移除字符串开头的空白字符
 */
export function trimStart(str: string): string {
  return str.trimStart()
}

/**
 * 移除字符串末尾的空白字符
 */
export function trimEnd(str: string): string {
  return str.trimEnd()
}

/**
 * 转换为小写
 */
export function toLowerCase(str: string): string {
  return str.toLowerCase()
}

/**
 * 转换为大写
 */
export function toUpperCase(str: string): string {
  return str.toUpperCase()
}

/**
 * 首字母大写
 */
export function capitalize(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * 驼峰命名转换为短横线命名
 * 示例: myVariable → my-variable
 */
export function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * 短横线命名转换为驼峰命名
 * 示例: my-variable → myVariable
 */
export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

// ==================== 数组处理 ====================

/**
 * 检查数组是否为空
 */
export function isEmptyArray<T>(arr: T[] | undefined | null): arr is [] {
  return !arr || arr.length === 0
}

/**
 * 检查数组是否非空
 */
export function isNonEmptyArray<T>(arr: T[] | undefined | null): arr is [T, ...T[]] {
  return !isEmptyArray(arr)
}

/**
 * 去重数组
 */
export function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

/**
 * 移除数组中的空值
 */
export function compact<T>(arr: (T | null | undefined)[]): T[] {
  return arr.filter((item): item is T => item !== null && item !== undefined)
}

/**
 * 数组分块
 * @param arr 原始数组
 * @param size 每块大小
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size))
  }
  return result
}

/**
 * 数组乱序
 */
export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = result[i]!
    result[i] = result[j]!
    result[j] = temp
  }
  return result
}

/**
 * 数组分组
 */
export function groupBy<T, K extends string | number>(
  arr: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  return arr.reduce((acc, item) => {
    const key = keyFn(item)
    acc[key] = acc[key] || []
    acc[key].push(item)
    return acc
  }, {} as Record<K, T[]>)
}

// ==================== 对象处理 ====================

/**
 * 深度合并对象
 */
export function deepMerge<T extends object>(
  target: T,
  ...sources: Partial<T>[]
): T {
  const result = { ...target }
  for (const source of sources) {
    for (const key in source) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (
        typeof sourceValue === 'object' &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === 'object' &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(
          targetValue as object,
          sourceValue as object
        ) as T[Extract<keyof T, string>]
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }
  return result
}

/**
 * 获取嵌套对象的属性
 * 示例: get(obj, 'a.b.c')
 */
export function get<T = unknown>(
  obj: object,
  path: string,
  defaultValue?: T
): T {
  const keys = path.split('.')
  let result: unknown = obj

  for (const key of keys) {
    if (result === null || result === undefined) {
      return defaultValue as T
    }
    result = (result as Record<string, unknown>)[key]
  }

  return (result === undefined ? defaultValue : result) as T
}

/**
 * 设置嵌套对象的属性
 * 示例: set(obj, 'a.b.c', value)
 */
export function set<T extends object>(
  obj: T,
  path: string,
  value: unknown
): T {
  const keys = path.split('.')
  let result: any = obj

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!
    if (!result[key]) {
      result[key] = {}
    }
    result = result[key]
  }

  const lastKey = keys[keys.length - 1]
  if (lastKey) {
    result[lastKey] = value
  }
  return obj
}

/**
 * 移除对象的指定属性
 */
export function omit<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result
}

/**
 * 只保留对象的指定属性
 */
export function pick<T extends object, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    result[key] = obj[key]
  }
  return result
}

// ==================== 数值处理 ====================

/**
 * 限制数值范围
 */
export function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max)
}

/**
 * 生成指定范围的随机整数
 * @param min 最小值（包含）
 * @param max 最大值（不包含）
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

/**
 * 生成指定范围的随机浮点数
 * @param min 最小值
 * @param max 最大值
 */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * 检查数值是否在范围内
 */
export function inRange(num: number, min: number, max: number): boolean {
  return num >= min && num < max
}

// ==================== 时间处理 ====================

/**
 * 格式化时间戳为相对时间
 * @param timestamp 时间戳（毫秒）
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  if (hours < 24) {
    return `${hours}小时前`
  }
  if (days < 7) {
    return `${days}天前`
  }

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
}

/**
 * 格式化日期
 */
export function formatDate(timestamp: number, format = 'YYYY-MM-DD'): string {
  const date = new Date(timestamp)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds)
}

// ==================== DOM 相关 ====================

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    // 降级：使用传统方法
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * 下载文件
 */
export function downloadFile(url: string, filename?: string): void {
  const link = document.createElement('a')
  link.href = url
  if (filename) {
    link.download = filename
  }
  link.click()
}

/**
 * 创建并下载 Blob 文件
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  downloadFile(url, filename)
  URL.revokeObjectURL(url)
}

// ==================== 防抖与节流 ====================

/**
 * 防抖函数
 * @param fn 要防抖的函数
 * @param delay 延迟时间（毫秒）
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

/**
 * 节流函数
 * @param fn 要节流的函数
 * @param limit 时间限制（毫秒）
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args)
      inThrottle = true
      setTimeout(() => {
        inThrottle = false
      }, limit)
    }
  }
}

/**
 * 节流（带立即执行）
 */
export function throttleImmediate<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0

  return (...args: Parameters<T>) => {
    const now = Date.now()
    if (now - lastCall >= limit) {
      fn(...args)
      lastCall = now
    }
  }
}

// ==================== 异步处理 ====================

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带超时的 Promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  timeoutError = new Error('Operation timed out')
): Promise<T> {
  return Promise.race([
    promise,
    delay(timeout).then(() => {
      throw timeoutError
    })
  ])
}

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number
    delay?: number
    backoff?: boolean
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delay: retryDelay = 1000, backoff = false } = options
  let lastError: Error | undefined

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      if (attempt < maxAttempts - 1) {
        const waitTime = backoff ? retryDelay * Math.pow(2, attempt) : retryDelay
        await delay(waitTime)
      }
    }
  }

  throw lastError
}

// ==================== 类工具 ====================

/**
 * LRU（最近最少使用）缓存实现
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  /** 获取缓存值 */
  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // 移动到末尾（最近使用）
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  /** 设置缓存值 */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧的
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  /** 检查是否存在 */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /** 删除缓存值 */
  delete(key: K): boolean {
    return this.cache.delete(key)
  }

  /** 清空缓存 */
  clear(): void {
    this.cache.clear()
  }

  /** 获取缓存大小 */
  get size(): number {
    return this.cache.size
  }

  /** 获取所有键 */
  keys(): K[] {
    return Array.from(this.cache.keys())
  }

  /** 获取所有值 */
  values(): V[] {
    return Array.from(this.cache.values())
  }

  /** 获取所有条目 */
  entries(): [K, V][] {
    return Array.from(this.cache.entries())
  }
}
