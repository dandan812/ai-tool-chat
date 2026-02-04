/**
 * 图片处理工具
 *
 * 功能特性：
 * - LRU 缓存，避免重复读取
 * - 图片压缩和尺寸调整
 * - Base64 转换
 * - 批量处理支持
 *
 * @package frontend/src/utils
 */

import type { ImageData } from '../types/task'
import { LRUCache, generateId, formatFileSize, IMAGE_CACHE_SIZE, IMAGE_COMPRESSION } from './common'

// ==================== 缓存 ====================

/**
 * 图片缓存实例（LRU，最多 20 张）
 * 使用文件指纹作为 key，避免相同文件重复读取
 */
const imageCache = new LRUCache<string, ImageData>(IMAGE_CACHE_SIZE)

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
  const {
    maxWidth = IMAGE_COMPRESSION.MAX_WIDTH,
    maxHeight = IMAGE_COMPRESSION.MAX_HEIGHT,
    quality = IMAGE_COMPRESSION.QUALITY
  } = options

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
 * 从 common.ts 导入，这里重新导出保持兼容性
 */
export { formatFileSize }
