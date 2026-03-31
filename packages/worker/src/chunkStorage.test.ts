import { describe, expect, it } from 'vitest';
import { ChunkStorage } from './chunkStorage';
import { createMockEnv, MemoryDurableObjectState, MemoryR2Bucket } from './test/mocks';

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
});
