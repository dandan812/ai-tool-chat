/**
 * 文件处理工具
 * 提供文件类型判断、图标和展示辅助能力
 */

/**
 * 支持的文本文件类型
 */
export const SUPPORTED_TEXT_TYPES = [
  // 纯文本
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/json',
  'text/xml',
  'text/yaml',
  'application/json',
  'application/xml',
  'application/yaml'
  // 代码文件（按扩展名判断更可靠）
]

/**
 * 支持的文本文件扩展名
 */
export const SUPPORTED_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'js',
  'ts',
  'jsx',
  'tsx',
  'mjs',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cc',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'kts',
  'sql',
  'sh',
  'bash',
  'ps1',
  'zsh',
  'log',
  'conf',
  'ini',
  'env',
  'properties',
  'vue',
  'svelte',
  'svg'
]

/**
 * 检查文件是否为支持的文本文件
 */
export function isSupportedTextFile(file: File): boolean {
  // 先检查 MIME 类型
  if (SUPPORTED_TEXT_TYPES.includes(file.type)) {
    return true
  }

  // 再检查扩展名（更可靠）
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  return SUPPORTED_EXTENSIONS.includes(ext)
}

export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]

export const SUPPORTED_DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx']

export const SUPPORTED_UPLOAD_ACCEPT = [
  ...SUPPORTED_TEXT_TYPES,
  ...SUPPORTED_DOCUMENT_TYPES,
  ...[...SUPPORTED_EXTENSIONS, ...SUPPORTED_DOCUMENT_EXTENSIONS].map((ext) => `.${ext}`)
].join(',')

/** Documents use server-side parsing; SVG source remains eligible for text/code upload. */
export function isSupportedUploadFile(file: File): boolean {
  const mimeType = file.type.toLowerCase()
  if (mimeType.startsWith('image/')) {
    return mimeType === 'image/svg+xml' && getFileExtension(file.name) === 'svg'
  }

  return (
    isSupportedTextFile(file) ||
    SUPPORTED_DOCUMENT_TYPES.includes(mimeType) ||
    SUPPORTED_DOCUMENT_EXTENSIONS.includes(getFileExtension(file.name))
  )
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || ''
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
