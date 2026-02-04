/**
 * 前端配置文件
 *
 * 统一管理应用配置，包括 API URL、常量、限制等
 * 避免在代码中硬编码配置值
 *
 * @package frontend/src
 */

// ==================== API 配置 ====================

/**
 * 后端 API 基础 URL
 * 部署在 Cloudflare Workers
 */
export const API_BASE_URL = 'https://api.i-tool-chat.store'

/**
 * API 端点路径
 */
export const API_ENDPOINTS = {
  /** 聊天/任务端点 */
  CHAT: '/',
  /** 健康检查端点 */
  HEALTH: '/health'
} as const

// ==================== 存储配置 ====================

/**
 * LocalStorage 键名前缀
 */
export const STORAGE_PREFIX = 'chat_'

/**
 * LocalStorage 键名
 */
export const STORAGE_KEYS = {
  /** 会话列表 */
  SESSION_LIST: `${STORAGE_PREFIX}session_list`,
  /** 消息映射（按会话 ID） */
  MESSAGES_MAP: `${STORAGE_PREFIX}messages_map`,
  /** 当前会话 ID */
  CURRENT_SESSION_ID: `${STORAGE_PREFIX}current_session_id`,
  /** 主题设置 */
  THEME: `${STORAGE_PREFIX}theme`
} as const

/**
 * LocalStorage 版本标识
 * 用于数据迁移和清理
 */
export const STORAGE_VERSION = 'v1'

/**
 * LocalStorage 最大容量（字节）
 * 一般为 5MB，这里设置为 4MB 留有余量
 */
export const MAX_STORAGE_SIZE = 4 * 1024 * 1024 // 4MB

// ==================== UI 配置 ====================

/**
 * 默认主题
 */
export const DEFAULT_THEME = 'light' as const

/**
 * 主题切换过渡时间（毫秒）
 */
export const THEME_TRANSITION_MS = 300

/**
 * 文本框最大高度（像素）
 */
export const TEXTAREA_MAX_HEIGHT = 160

/**
 * 文本框最小高度（像素）
 */
export const TEXTAREA_MIN_HEIGHT = 36

/**
 * 自动滚动阈值（像素）
 * 距离底部小于此值时自动滚动
 */
export const AUTO_SCROLL_THRESHOLD = 100

/**
 * 防抖延迟（毫秒）
 * 用于输入框调整、存储保存等
 */
export const DEBOUNCE_MS = 300

// ==================== 限制配置 ====================

/**
 * 标题最大长度
 */
export const MAX_TITLE_LENGTH = 50

/**
 * 单次最多上传图片数量
 */
export const MAX_IMAGES = 4

/**
 * 单个文本文件最大大小（字节）
 */
export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 图片缓存最大数量
 */
export const IMAGE_CACHE_SIZE = 20

/**
 * 虚拟滚动预渲染数量
 */
export const VIRTUAL_SCROLL_OVERSCAN = 5

// ==================== 性能配置 ====================

/**
 * 流式内容更新频率（毫秒）
 * 控制流式内容渲染的更新频率，避免过于频繁的 DOM 更新
 */
export const STREAM_UPDATE_THROTTLE = 50

/**
 * 图片压缩配置
 */
export const IMAGE_COMPRESSION = {
  /** 最大宽度 */
  MAX_WIDTH: 1920,
  /** 最大高度 */
  MAX_HEIGHT: 1080,
  /** 压缩质量（0-1） */
  QUALITY: 0.85
} as const

// ==================== AI 配置 ====================

/**
 * 默认温度值
 * 控制输出的随机性，越高越随机
 */
export const DEFAULT_TEMPERATURE = 0.7

/**
 * 智能标题生成阈值
 * 前几条消息后开始生成标题
 */
export const TITLE_GENERATION_THRESHOLD = 3

/**
 * 智能标题最大长度
 */
export const MAX_TITLE_GENERATED_LENGTH = 10

// ==================== 环境配置 ====================

/**
 * 是否为开发环境
 */
export const isDevelopment = import.meta.env.DEV

/**
 * 是否为生产环境
 */
export const isProduction = import.meta.env.PROD

/**
 * 应用版本
 */
export const APP_VERSION = '1.3.0'

/**
 * 应用名称
 */
export const APP_NAME = 'AI Chat'

// ==================== 调试配置 ====================

/**
 * 是否启用调试日志
 * 生产环境自动禁用
 */
export const DEBUG = isDevelopment

/**
 * 调试日志函数
 * 仅在调试模式下输出
 */
export const debug = {
  log: (...args: unknown[]) => {
    if (DEBUG) console.log('[App]', ...args)
  },
  warn: (...args: unknown[]) => {
    if (DEBUG) console.warn('[App]', ...args)
  },
  error: (...args: unknown[]) => {
    if (DEBUG) console.error('[App]', ...args)
  }
}

// ==================== 工具函数 ====================

/**
 * 检查是否支持存储
 */
export function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

/**
 * 检查是否在线
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine
}

/**
 * 安全的 JSON 解析
 */
export function safeJSONParse<T = unknown>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

/**
 * 生成唯一 ID
 * 基于时间戳和随机数，生成短且唯一的 ID
 * 格式: {timestamp}-{random}
 * 示例: lw1a2b3c4-5d6e7f
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 格式化后的字符串（如 "1.23 KB"）
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
