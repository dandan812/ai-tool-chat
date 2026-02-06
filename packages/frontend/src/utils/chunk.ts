/**
 * 文件分片上传工具
 *
 * 功能：
 * - 计算文件 MD5 哈希
 * - 切分文件为多个分片
 * - 分片上传到后端
 * - 进度追踪
 *
 * @package frontend/src/utils
 */

import type { FileData, UploadProgress, UploadProgressCallback } from '../types/task';
import { API_BASE_URL } from '../config';
import { generateId } from './file';

/**
 * 分片大小配置
 */
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * 使用 SparkMD5 计算文件哈希
 */
export async function calculateFileMD5(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    // 动态导入 SparkMD5
    import('spark-md5').then((SparkMD5) => {
      const spark = new SparkMD5.ArrayBuffer();
      const reader = new FileReader();

      reader.onload = (e) => {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        if (arrayBuffer) {
          spark.append(arrayBuffer);
          const hash = spark.end();
          console.log('[Chunk] File MD5 calculated:', {
            name: file.name,
            size: file.size,
            hash
          });
          resolve(hash);
        } else {
          reject(new Error('Failed to read file for MD5 calculation'));
        }
      };

      reader.onerror = () => {
        reject(new Error('FileReader error while calculating MD5'));
      };

      reader.readAsArrayBuffer(file);
    }).catch((error) => {
      reject(new Error(`Failed to import SparkMD5: ${error}`));
    });
  });
}

/**
 * 切分文件为多个分片
 */
export function splitIntoChunks(file: File, chunkSize = DEFAULT_CHUNK_SIZE): Blob[] {
  const chunks: Blob[] = [];
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    chunks.push(chunk);
  }

  console.log('[Chunk] File split into chunks:', {
    name: file.name,
    totalChunks,
    chunkSize,
    fileSize: file.size,
  });

  return chunks;
}

/**
 * 计算文件分片数量
 */
export function calculateChunkCount(file: File, chunkSize = DEFAULT_CHUNK_SIZE): number {
  return Math.ceil(file.size / chunkSize);
}

/**
 * 分片上传文件
 */
export async function uploadChunkedFile(
  file: File,
  options: {
    onProgress?: UploadProgressCallback;
    chunkSize?: number;
    apiUrl?: string;
  } = {}
): Promise<FileData> {
  const {
    onProgress,
    chunkSize = DEFAULT_CHUNK_SIZE,
  } = options;

  const fileId = generateId();
  const chunks = splitIntoChunks(file, chunkSize);
  const totalChunks = chunks.length;

  console.log('[Chunk] Starting chunked upload:', {
    fileId,
    fileName: file.name,
    fileSize: file.size,
    totalChunks,
    chunkSize,
  });

  try {
    // 计算 MD5
    const fileHash = await calculateFileMD5(file);

    // 上传进度追踪
    const startTime = Date.now();
    let uploadedBytes = 0;

    // 逐个上传分片
    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i];
      if (!chunk) {
        throw new Error(`Chunk ${i} not found`);
      }
      const chunkData = await chunk.arrayBuffer();

      const formData = new FormData();
      formData.append('fileId', fileId);
      formData.append('chunkIndex', String(i));
      formData.append('totalChunks', String(totalChunks));
      formData.append('fileHash', fileHash);
      formData.append('chunk', new Blob([chunkData], { type: file.type || 'text/plain' }));
      formData.append('mimeType', file.type || 'text/plain');

      const response = await fetch(`${API_BASE_URL}/upload/chunk`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`分片 ${i + 1}/${totalChunks} 上传失败: ${errorText}`);
      }

      // 更新上传进度
      uploadedBytes += chunkData.byteLength;
      const elapsed = (Date.now() - startTime) / 1000; // 秒
      const speed = elapsed > 0 ? uploadedBytes / 1024 / elapsed : 0; // KB/s
      const remainingBytes = file.size - uploadedBytes;
      const estimatedTime = speed > 0 ? remainingBytes / 1024 / speed : 0; // 秒

      const progress: UploadProgress = {
        fileId,
        fileName: file.name,
        uploadedChunks: i + 1,
        totalChunks,
        percentage: ((i + 1) / totalChunks) * 100,
        speed,
        estimatedTime,
      };

      console.log('[Chunk] Chunk uploaded:', {
        chunkIndex: i + 1,
        totalChunks,
        percentage: progress.percentage.toFixed(1),
        speed: speed.toFixed(2),
        estimatedTime: estimatedTime.toFixed(0),
      });

      // 触发进度回调
      if (onProgress) {
        onProgress(progress);
      }
    }

    // 所有分片上传完成，通知后端合并
    console.log('[Chunk] All chunks uploaded, completing upload...', {
      fileId,
      fileName: file.name,
      fileHash,
    });

    const completeResponse = await fetch(`${API_BASE_URL}/upload/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        fileHash,
        fileName: file.name,
        mimeType: file.type || 'text/plain',
      }),
    });

    if (!completeResponse.ok) {
      const errorText = await completeResponse.text();
      throw new Error(`文件合并失败: ${errorText}`);
    }

    const result = await completeResponse.json();
    const fileData = result.fileData as FileData;

    console.log('[Chunk] File upload completed:', {
      fileId,
      fileName: file.name,
      contentLength: fileData.content?.length || 0,
      size: fileData.size,
    });

    return fileData;
  } catch (error) {
    console.error('[Chunk] Upload failed:', error);
    throw error;
  }
}

/**
 * 查询上传状态
 */
export async function getUploadStatus(
  fileId: string
): Promise<{
    fileId: string;
    fileName?: string;
    receivedChunks?: number;
    totalChunks?: number;
    isComplete?: boolean;
    percentage?: number;
  }> {
  const response = await fetch(`${API_BASE_URL}/upload/status?fileId=${fileId}`);

  if (!response.ok) {
    throw new Error('查询上传状态失败');
  }

  return response.json();
}

/**
 * 格式化上传进度文本
 */
export function formatUploadProgress(progress: UploadProgress): string {
  const { percentage, speed, estimatedTime } = progress;

  if (estimatedTime > 60) {
    const minutes = Math.floor(estimatedTime / 60);
    const seconds = Math.round(estimatedTime % 60);
    return `${percentage.toFixed(1)}% (${speed.toFixed(1)} KB/s, 剩余 ${minutes}分${seconds}秒)`;
  } else if (estimatedTime > 0) {
    return `${percentage.toFixed(1)}% (${speed.toFixed(1)} KB/s, 剩余 ${Math.round(estimatedTime)}秒)`;
  } else {
    return `${percentage.toFixed(1)}%`;
  }
}

/**
 * 检查是否应该使用分片上传
 */
export function shouldUseChunking(file: File, threshold = 2 * 1024 * 1024): boolean {
  // 默认 2MB 以上使用分片上传
  return file.size > threshold;
}
