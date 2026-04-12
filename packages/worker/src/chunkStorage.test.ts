import { describe, expect, it } from 'vitest';
import { ChunkStorage } from './chunkStorage';
import { createMockEnv, MemoryDurableObjectState, MemoryR2Bucket } from './test/mocks';
import { getUploadedFileChunkObjectKey } from './utils/uploadedFileStorage';

function createChunkFormData(overrides: Partial<{
  fileId: string;
  fileName: string;
  fileSize: number;
  chunkIndex: number;
  totalChunks: number;
  fileHash: string;
  mimeType: string;
  content: string;
}> = {}): FormData {
  const fileId = overrides.fileId ?? 'file-1';
  const fileName = overrides.fileName ?? 'demo.txt';
  const content = overrides.content ?? 'hello world';
  const fileSize = overrides.fileSize ?? new File([content], fileName, { type: 'text/plain' }).size;
  const chunkIndex = overrides.chunkIndex ?? 0;
  const totalChunks = overrides.totalChunks ?? 1;
  const fileHash = overrides.fileHash ?? 'hash-1';
  const mimeType = overrides.mimeType ?? 'text/plain';

  const formData = new FormData();
  formData.append('fileId', fileId);
  formData.append('fileName', fileName);
  formData.append('fileSize', String(fileSize));
  formData.append('chunkIndex', String(chunkIndex));
  formData.append('totalChunks', String(totalChunks));
  formData.append('fileHash', fileHash);
  formData.append('mimeType', mimeType);
  formData.append('chunk', new File([content], fileName, { type: mimeType }));
  return formData;
}

describe('ChunkStorage', () => {
  it('应该把分片合并后写入 R2', async () => {
    const state = new MemoryDurableObjectState();
    const env = createMockEnv();
    const storage = new ChunkStorage(
      state as unknown as DurableObjectState,
      env,
    );

    await storage.fetch(new Request('https://chunk-storage/?action=storeChunk', {
      method: 'POST',
      body: createChunkFormData({
        fileId: 'merge-file',
        fileName: 'merge.txt',
        content: '你好，世界',
        fileHash: 'merge-hash',
      }),
    }));

    const mergeResponse = await storage.fetch(
      new Request('https://chunk-storage/?action=mergeChunks&fileId=merge-file'),
    );
    const mergeResult = await mergeResponse.json() as { success: boolean; file?: { fileId: string } };
    const uploadedObject = await (env.UPLOADED_FILES as unknown as MemoryR2Bucket).get('uploaded-files/merge-file');

    expect(mergeResult.success).toBe(true);
    expect(mergeResult.file?.fileId).toBe('merge-file');
    await expect(uploadedObject?.text()).resolves.toBe('你好，世界');
  });

  it('应该按顺序合并多个 R2 分片并在完成后清理分片对象', async () => {
    const state = new MemoryDurableObjectState();
    const env = createMockEnv();
    const storage = new ChunkStorage(
      state as unknown as DurableObjectState,
      env,
    );
    const bucket = env.UPLOADED_FILES as unknown as MemoryR2Bucket;

    await storage.fetch(new Request('https://chunk-storage/?action=storeChunk', {
      method: 'POST',
      body: createChunkFormData({
        fileId: 'multi-file',
        fileName: 'multi.txt',
        fileSize: 6,
        chunkIndex: 0,
        totalChunks: 3,
        content: 'ab',
        fileHash: 'multi-hash',
      }),
    }));
    await storage.fetch(new Request('https://chunk-storage/?action=storeChunk', {
      method: 'POST',
      body: createChunkFormData({
        fileId: 'multi-file',
        fileName: 'multi.txt',
        fileSize: 6,
        chunkIndex: 1,
        totalChunks: 3,
        content: 'cd',
        fileHash: 'multi-hash',
      }),
    }));
    await storage.fetch(new Request('https://chunk-storage/?action=storeChunk', {
      method: 'POST',
      body: createChunkFormData({
        fileId: 'multi-file',
        fileName: 'multi.txt',
        fileSize: 6,
        chunkIndex: 2,
        totalChunks: 3,
        content: 'ef',
        fileHash: 'multi-hash',
      }),
    }));

    const mergeResponse = await storage.fetch(
      new Request('https://chunk-storage/?action=mergeChunks&fileId=multi-file'),
    );
    const mergeResult = await mergeResponse.json() as { success: boolean };
    const uploadedObject = await bucket.get('uploaded-files/multi-file');

    expect(mergeResult.success).toBe(true);
    await expect(uploadedObject?.text()).resolves.toBe('abcdef');
    await expect(bucket.head(getUploadedFileChunkObjectKey('multi-file', 0))).resolves.toBeNull();
    await expect(bucket.head(getUploadedFileChunkObjectKey('multi-file', 1))).resolves.toBeNull();
    await expect(bucket.head(getUploadedFileChunkObjectKey('multi-file', 2))).resolves.toBeNull();
  });

  it('应该在分片缺失时修正元数据并返回 incomplete upload', async () => {
    const state = new MemoryDurableObjectState();
    const env = createMockEnv();
    const storage = new ChunkStorage(
      state as unknown as DurableObjectState,
      env,
    );

    await state.storage.put('meta:broken-file', {
      fileId: 'broken-file',
      fileName: 'broken.txt',
      fileHash: 'broken-hash',
      totalSize: 12,
      totalChunks: 1,
      receivedChunks: 1,
      receivedIndices: [0],
      mimeType: 'text/plain',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const response = await storage.fetch(
      new Request('https://chunk-storage/?action=mergeChunks&fileId=broken-file'),
    );
    const result = await response.json() as { success: boolean; error: string };
    const metadata = await state.storage.get<{
      receivedChunks: number;
      receivedIndices: number[];
    }>('meta:broken-file');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Incomplete upload');
    expect(metadata?.receivedChunks).toBe(0);
    expect(metadata?.receivedIndices).toEqual([]);
  });

  it('删除上传时应该同时清理 R2 分片对象', async () => {
    const state = new MemoryDurableObjectState();
    const env = createMockEnv();
    const storage = new ChunkStorage(
      state as unknown as DurableObjectState,
      env,
    );
    const bucket = env.UPLOADED_FILES as unknown as MemoryR2Bucket;

    await storage.fetch(new Request('https://chunk-storage/?action=storeChunk', {
      method: 'POST',
      body: createChunkFormData({
        fileId: 'delete-file',
        chunkIndex: 0,
        totalChunks: 1,
        content: 'to-delete',
      }),
    }));

    await storage.fetch(
      new Request('https://chunk-storage/?action=deleteFile&fileId=delete-file'),
    );

    await expect(bucket.head(getUploadedFileChunkObjectKey('delete-file', 0))).resolves.toBeNull();
    await expect(state.storage.get('meta:delete-file')).resolves.toBeUndefined();
  });
});
