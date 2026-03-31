/**
 * 文件分片上传工具
 *
 * 功能：
 * - 按分片增量计算文件 MD5，避免整文件一次性读入内存
 * - 按稳定 fileId 进行上传，支持重复选择同一个文件时恢复
 * - 上传前先查询服务端状态，只补传缺失分片
 * - 在浏览器本地保存上传会话，用于页面刷新后的断点恢复提示
 *
 * @package frontend/src/utils
 */

import type { UploadedFileRef, UploadCompleteResponse, UploadProgress, UploadProgressCallback } from '../types/task';
import { API_BASE_URL } from '../config';

/**
 * 分片大小配置
 * 改小为 1MB，避免 Cloudflare Workers 堆栈溢出问题
 */
const DEFAULT_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB
const UPLOAD_SESSION_STORAGE_KEY = 'chat_upload_sessions_v1';

interface UploadSession {
  fileId: string;
  fileHash: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  uploadedChunkIndices: number[];
  updatedAt: number;
}

/**
 * 使用 SparkMD5 按分片增量计算文件哈希
 */
export async function calculateFileMD5(
  file: File,
  chunkSize = DEFAULT_CHUNK_SIZE
): Promise<string> {
  const SparkMD5 = await import('spark-md5');
  const spark = new SparkMD5.ArrayBuffer();
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunkBuffer = await file.slice(start, end).arrayBuffer();
    spark.append(chunkBuffer);
  }

  const hash = spark.end();
  console.log('[Chunk] File MD5 calculated:', {
    name: file.name,
    size: file.size,
    hash,
    totalChunks,
  });
  return hash;
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
    chunks.push(file.slice(start, end));
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

function buildResumableFileId(file: File, fileHash: string): string {
  return `${fileHash}-${file.size}`;
}

function getUploadSessionMap(): Record<string, UploadSession> {
  try {
    const raw = localStorage.getItem(UPLOAD_SESSION_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, UploadSession>;
  } catch {
    return {};
  }
}

function setUploadSessionMap(sessionMap: Record<string, UploadSession>): void {
  localStorage.setItem(UPLOAD_SESSION_STORAGE_KEY, JSON.stringify(sessionMap));
}

function saveUploadSession(session: UploadSession): void {
  const sessionMap = getUploadSessionMap();
  sessionMap[session.fileId] = session;
  setUploadSessionMap(sessionMap);
}

function deleteUploadSession(fileId: string): void {
  const sessionMap = getUploadSessionMap();
  delete sessionMap[fileId];
  setUploadSessionMap(sessionMap);
}

function getChunkSizeSum(chunks: Blob[], chunkIndices: Set<number>): number {
  let totalSize = 0;
  for (const index of chunkIndices) {
    totalSize += chunks[index]?.size || 0;
  }
  return totalSize;
}

function createUploadProgress(
  fileId: string,
  fileName: string,
  uploadedChunks: number,
  totalChunks: number,
  uploadedBytes: number,
  fileSize: number,
  startTime: number
): UploadProgress {
  const elapsed = (Date.now() - startTime) / 1000;
  const speed = elapsed > 0 ? uploadedBytes / 1024 / elapsed : 0;
  const remainingBytes = Math.max(fileSize - uploadedBytes, 0);
  const estimatedTime = speed > 0 ? remainingBytes / 1024 / speed : 0;

  return {
    fileId,
    fileName,
    uploadedChunks,
    totalChunks,
    percentage: totalChunks > 0 ? (uploadedChunks / totalChunks) * 100 : 0,
    speed,
    estimatedTime,
  };
}

async function queryUploadStatus(fileId: string): Promise<{
  fileId: string;
  fileName?: string;
  fileHash?: string;
  receivedChunks?: number;
  totalChunks?: number;
  receivedIndices?: number[];
  isComplete?: boolean;
  percentage?: number;
} | null> {
  const response = await fetch(`${API_BASE_URL}/upload/status?fileId=${encodeURIComponent(fileId)}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('查询上传状态失败');
  }

  return response.json();
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
): Promise<UploadedFileRef> {
  const { onProgress, chunkSize = DEFAULT_CHUNK_SIZE } = options;
  const chunks = splitIntoChunks(file, chunkSize);
  const totalChunks = chunks.length;

  try {
    console.log('[Chunk] Calculating MD5 for resumable upload...');
    const fileHash = await calculateFileMD5(file, chunkSize);
    const fileId = buildResumableFileId(file, fileHash);
    const startTime = Date.now();

    const serverStatus = await queryUploadStatus(fileId);
    const savedSession = getUploadSessionMap()[fileId];
    const uploadedChunkIndices = new Set<number>([
      ...(serverStatus?.receivedIndices || []),
      ...(savedSession?.uploadedChunkIndices || []),
    ]);

    let uploadedBytes = getChunkSizeSum(chunks, uploadedChunkIndices);

    console.log('[Chunk] Starting chunked upload:', {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      uploadedChunks: uploadedChunkIndices.size,
      resumed: uploadedChunkIndices.size > 0,
    });

    saveUploadSession({
      fileId,
      fileHash,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      uploadedChunkIndices: Array.from(uploadedChunkIndices).sort((a, b) => a - b),
      updatedAt: Date.now(),
    });

    if (onProgress) {
      onProgress(
        createUploadProgress(
          fileId,
          file.name,
          uploadedChunkIndices.size,
          totalChunks,
          uploadedBytes,
          file.size,
          startTime
        )
      );
    }

    for (let i = 0; i < totalChunks; i++) {
      if (uploadedChunkIndices.has(i)) {
        console.log(`[Chunk] Skip uploaded chunk ${i + 1}/${totalChunks}`);
        continue;
      }

      const chunk = chunks[i];
      if (!chunk) {
        throw new Error(`Chunk ${i} not found`);
      }

      const chunkData = await chunk.arrayBuffer();
      const formData = new FormData();
      formData.append('fileId', fileId);
      formData.append('fileName', file.name);
      formData.append('fileSize', String(file.size));
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

      const result = await response.json();
      const receivedIndices = Array.isArray(result.receivedIndices)
        ? result.receivedIndices as number[]
        : [i];

      for (const index of receivedIndices) {
        uploadedChunkIndices.add(index);
      }

      uploadedBytes = getChunkSizeSum(chunks, uploadedChunkIndices);

      saveUploadSession({
        fileId,
        fileHash,
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        uploadedChunkIndices: Array.from(uploadedChunkIndices).sort((a, b) => a - b),
        updatedAt: Date.now(),
      });

      if (onProgress) {
        onProgress(
          createUploadProgress(
            fileId,
            file.name,
            uploadedChunkIndices.size,
            totalChunks,
            uploadedBytes,
            file.size,
            startTime
          )
        );
      }
    }

    console.log('[Chunk] All missing chunks uploaded, completing upload...', {
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

    const result = await completeResponse.json() as UploadCompleteResponse;
    const uploadedFile = result.file;

    if (!uploadedFile) {
      throw new Error('文件上传成功，但未返回文件引用');
    }

    console.log('[Chunk] File upload completed:', {
      fileId,
      fileName: file.name,
      size: uploadedFile.size,
    });

    deleteUploadSession(fileId);
    return uploadedFile;
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
  const response = await fetch(`${API_BASE_URL}/upload/status?fileId=${encodeURIComponent(fileId)}`);

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
export function shouldUseChunking(file: File, threshold = 500 * 1024): boolean {
  return file.size > threshold;
}
