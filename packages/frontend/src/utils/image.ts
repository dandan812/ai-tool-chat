import type { ImageData } from '../types/task'

/**
 * 图片处理工具 - 优化版
 * 支持缓存、压缩、批量处理
 */

// LRU 缓存实现
class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // 移动到末尾（最近使用）
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

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

  clear(): void {
    this.cache.clear()
  }
}

// 图片缓存（最多 20 张）
const imageCache = new LRUCache<string, ImageData>(20)

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 生成文件指纹（用于缓存）
 */
async function generateFileFingerprint(file: File): Promise<string> {
  // 使用文件名+大小+修改时间作为简单指纹
  const data = `${file.name}-${file.size}-${file.lastModified}`
  
  // 使用 SubtleCrypto 生成哈希（如果可用）
  if ('crypto' in window && 'subtle' in window.crypto) {
    const encoder = new TextEncoder()
    const buffer = await window.crypto.subtle.digest('SHA-256', encoder.encode(data))
    const array = Array.from(new Uint8Array(buffer))
    return array.map(b => b.toString(16).padStart(2, '0')).slice(0, 16).join('')
  }
  
  // 降级：使用 Base64
  return btoa(data).slice(0, 16)
}

/**
 * 将 File 转换为 ImageData - 带缓存
 */
export async function fileToImageData(file: File): Promise<ImageData> {
  // 生成文件指纹
  const fingerprint = await generateFileFingerprint(file)
  
  // 检查缓存
  const cached = imageCache.get(fingerprint)
  if (cached) {
    return { ...cached, id: generateId() } // 复制一份，但生成新 ID
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const base64 = reader.result as string
      // 移除 data:image/xxx;base64, 前缀
      const base64Data = base64.split(',')[1]

      const imageData: ImageData = {
        id: generateId(),
        base64: base64Data || '',
        mimeType: file.type,
        file: file
      }

      // 存入缓存
      imageCache.set(fingerprint, imageData)
      resolve(imageData)
    }

    reader.onerror = () => {
      reject(new Error(`Failed to read file: ${file.name}`))
    }

    reader.readAsDataURL(file)
  })
}

/**
 * 压缩图片
 */
export async function compressImage(
  file: File,
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {}
): Promise<Blob> {
  const { maxWidth = 1920, maxHeight = 1080, quality = 0.8 } = options

  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // 计算缩放后的尺寸
      let { width, height } = img
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1)
      
      if (ratio < 1) {
        width *= ratio
        height *= ratio
      }

      // 创建 Canvas
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Failed to get canvas context'))
        return
      }

      // 绘制图片
      ctx.drawImage(img, 0, 0, width, height)

      // 导出为 Blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Compression failed'))
          }
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

/**
 * 批量转换文件
 */
export async function filesToImageData(files: File[]): Promise<ImageData[]> {
  const results = await Promise.allSettled(files.map(file => fileToImageData(file)))
  
  return results
    .filter((result): result is PromiseFulfilledResult<ImageData> => 
      result.status === 'fulfilled'
    )
    .map(result => result.value)
}

/**
 * 清空图片缓存
 */
export function clearImageCache(): void {
  imageCache.clear()
}

/**
 * 检查文件是否为图片
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
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
