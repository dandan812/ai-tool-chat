/**
 * 文件处理工具
 * 提供文件类型判断、图标和展示辅助能力
 */

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

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
  'application/yaml',
  // 代码文件（按扩展名判断更可靠）
]

/**
 * 支持的文本文件扩展名
 */
export const SUPPORTED_EXTENSIONS = [
  'txt', 'md', 'markdown',
  'csv', 'json', 'xml', 'yaml', 'yml',
  'js', 'ts', 'jsx', 'tsx', 'mjs',
  'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cc',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts',
  'sql', 'sh', 'bash', 'ps1', 'zsh',
  'log', 'conf', 'ini', 'env', 'properties',
  'vue', 'svelte', 'svg'
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

/**
 * 获取文件图标（根据扩展名）
 */
export function getFileIcon(filename: string): string {
  const ext = getFileExtension(filename)
  
  const iconMap: Record<string, string> = {
    // 代码文件
    'js': 'js', 'ts': 'ts', 'jsx': 'react', 'tsx': 'react',
    'py': 'python',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'html': 'html', 'htm': 'html',
    'css': 'css', 'scss': 'scss', 'sass': 'scss', 'less': 'css',
    'json': 'json',
    'xml': 'xml',
    'sql': 'sql',
    'md': 'markdown', 'markdown': 'markdown',
    // 配置文件
    'env': 'config', 'ini': 'config', 'conf': 'config',
    'yaml': 'yaml', 'yml': 'yaml',
    // 文本
    'txt': 'text', 'log': 'text',
    'csv': 'csv',
  }
  
  return iconMap[ext] || 'file'
}

/**
 * 获取文件语言（用于代码高亮）
 */
export function getFileLanguage(filename: string): string {
  const ext = getFileExtension(filename)
  
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'ts': 'typescript',
    'jsx': 'jsx',
    'tsx': 'tsx',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp', 'cc': 'cpp', 'hpp': 'cpp',
    'h': 'c',
    'go': 'go',
    'rs': 'rust',
    'rb': 'ruby',
    'php': 'php',
    'swift': 'swift',
    'kt': 'kotlin', 'kts': 'kotlin',
    'html': 'html', 'htm': 'html',
    'css': 'css',
    'scss': 'scss', 'sass': 'scss',
    'less': 'less',
    'sql': 'sql',
    'sh': 'bash', 'bash': 'bash',
    'ps1': 'powershell',
    'json': 'json',
    'xml': 'xml',
    'yaml': 'yaml', 'yml': 'yaml',
    'md': 'markdown', 'markdown': 'markdown',
    'vue': 'vue',
    'svelte': 'svelte',
    'svg': 'svg'
  }
  
  return langMap[ext] || 'text'
}
