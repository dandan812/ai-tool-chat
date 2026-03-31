import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateFileMD5, uploadChunkedFile } from './chunk';

const ORIGINAL_FETCH = globalThis.fetch;

function createMockFile(content: string, name: string, type: string): File {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);

  const file = {
    name,
    type,
    size: bytes.byteLength,
    slice(start = 0, end = bytes.byteLength) {
      const sliced = bytes.slice(start, end);
      return {
        size: sliced.byteLength,
        type,
        async arrayBuffer() {
          return sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength);
        },
      } as Blob;
    },
  };

  return file as unknown as File;
}

function createUploadResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('uploadChunkedFile', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('服务端没有状态记录时，应该忽略陈旧本地会话并重新上传分片', async () => {
    const file = createMockFile('hello world', 'demo.txt', 'text/plain');
    const fileHash = await calculateFileMD5(file);
    const fileId = `${fileHash}-${file.size}`;

    localStorage.setItem('chat_upload_sessions_v1', JSON.stringify({
      [fileId]: {
        fileId,
        fileHash,
        fileName: file.name,
        fileSize: file.size,
        totalChunks: 1,
        uploadedChunkIndices: [0],
        updatedAt: Date.now(),
      },
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(createUploadResponse({
        success: true,
        chunkIndex: 0,
        fileId,
        receivedChunks: 1,
        receivedIndices: [0],
      }))
      .mockResolvedValueOnce(createUploadResponse({
        success: true,
        file: {
          fileId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          fileHash,
          source: 'uploaded',
        },
      }));

    globalThis.fetch = fetchMock as typeof fetch;

    const uploaded = await uploadChunkedFile(file);

    expect(uploaded.fileId).toBe(fileId);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/upload/chunk');
    expect(localStorage.getItem('chat_upload_sessions_v1')).toBe('{}');
  });

  it('合并失败且服务端缺片时，应该补传缺失分片并重试一次 complete', async () => {
    const file = createMockFile('retry-content', 'retry.txt', 'text/plain');
    const fileHash = await calculateFileMD5(file);
    const fileId = `${fileHash}-${file.size}`;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(createUploadResponse({
        success: true,
        chunkIndex: 0,
        fileId,
        receivedChunks: 1,
        receivedIndices: [0],
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: 'Incomplete upload: 0/1 chunks received' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ))
      .mockResolvedValueOnce(createUploadResponse({
        fileId,
        fileName: file.name,
        receivedChunks: 0,
        totalChunks: 1,
        receivedIndices: [],
      }))
      .mockResolvedValueOnce(createUploadResponse({
        success: true,
        chunkIndex: 0,
        fileId,
        receivedChunks: 1,
        receivedIndices: [0],
      }))
      .mockResolvedValueOnce(createUploadResponse({
        success: true,
        file: {
          fileId,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          fileHash,
          source: 'uploaded',
        },
      }));

    globalThis.fetch = fetchMock as typeof fetch;

    const uploaded = await uploadChunkedFile(file);

    expect(uploaded.fileId).toBe(fileId);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls[3]?.[0]).toContain('/upload/status');
    expect(fetchMock.mock.calls[4]?.[0]).toContain('/upload/chunk');
    expect(fetchMock.mock.calls[5]?.[0]).toContain('/upload/complete');
  });
});
