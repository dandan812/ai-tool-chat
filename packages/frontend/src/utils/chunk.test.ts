import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateFileMD5, uploadChunkedFile } from './chunk'
import { accountStorageKey, setStorageAccount } from '../api/account'
import { API_BASE_URL } from '../config'

const ORIGINAL_FETCH = globalThis.fetch

function createMockFile(content: string, name: string, type: string): File {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(content)

  const file = {
    name,
    type,
    size: bytes.byteLength,
    slice(start = 0, end = bytes.byteLength) {
      const sliced = bytes.slice(start, end)
      return {
        size: sliced.byteLength,
        type,
        async arrayBuffer() {
          return sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength)
        }
      } as Blob
    }
  }

  return file as unknown as File
}

function createUploadResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('uploadChunkedFile', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    globalThis.fetch = ORIGINAL_FETCH
    setStorageAccount('alice')
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
    vi.restoreAllMocks()
  })

  it('服务端没有状态记录时，应该忽略陈旧本地会话并重新上传分片', async () => {
    const file = createMockFile('hello world', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file)
    const fileId = `${fileHash}-${file.size}`

    const storageKey = accountStorageKey('chat_upload_sessions_v1')
    localStorage.setItem('chat_upload_sessions_v1', '{"legacy":"preserve"}')
    localStorage.setItem('account:other-user:chat_upload_sessions_v1', '{"other":"preserve"}')
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        [fileId]: {
          fileId,
          fileHash,
          fileName: file.name,
          fileSize: file.size,
          totalChunks: 1,
          uploadedChunkIndices: [0],
          updatedAt: Date.now()
        }
      })
    )

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          chunkIndex: 0,
          fileId,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          file: {
            fileId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            fileHash,
            source: 'uploaded'
          }
        })
      )

    globalThis.fetch = fetchMock as typeof fetch

    const uploaded = await uploadChunkedFile(file)

    expect(uploaded.fileId).toBe(fileId)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/upload/chunk')
    expect(localStorage.getItem(storageKey)).toBe('{}')
    expect(localStorage.getItem('chat_upload_sessions_v1')).toBe('{"legacy":"preserve"}')
    expect(localStorage.getItem('account:other-user:chat_upload_sessions_v1')).toBe(
      '{"other":"preserve"}'
    )
  })

  it('合并失败且服务端缺片时，应该补传缺失分片并重试一次 complete', async () => {
    const file = createMockFile('retry-content', 'retry.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file)
    const fileId = `${fileHash}-${file.size}`

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          chunkIndex: 0,
          fileId,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Incomplete upload: 0/1 chunks received' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          fileId,
          fileName: file.name,
          receivedChunks: 0,
          totalChunks: 1,
          receivedIndices: []
        })
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          chunkIndex: 0,
          fileId,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          file: {
            fileId,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            fileHash,
            source: 'uploaded'
          }
        })
      )

    globalThis.fetch = fetchMock as typeof fetch

    const uploaded = await uploadChunkedFile(file)

    expect(uploaded.fileId).toBe(fileId)
    expect(fetchMock).toHaveBeenCalledTimes(6)
    expect(fetchMock.mock.calls[3]?.[0]).toContain('/upload/status')
    expect(fetchMock.mock.calls[4]?.[0]).toContain('/upload/chunk')
    expect(fetchMock.mock.calls[5]?.[0]).toContain('/upload/complete')
  })

  it.each([0, -1, 1.5, NaN, Infinity, 5 * 1024 * 1024 + 1, null])(
    'rejects invalid chunkSize %s before reading or contacting the server',
    async (chunkSize) => {
      const file = createMockFile('hello', 'demo.txt', 'text/plain')
      const slice = vi.spyOn(file, 'slice')
      const fetchMock = vi.fn()
      globalThis.fetch = fetchMock
      await expect(uploadChunkedFile(file, { chunkSize: chunkSize as number })).rejects.toThrow(
        'chunkSize'
      )
      await expect(calculateFileMD5(file, chunkSize as number)).rejects.toThrow('chunkSize')
      expect(slice).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('rejects empty files and layouts exceeding the server chunk limit before network I/O', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    await expect(uploadChunkedFile(createMockFile('', 'empty.txt', 'text/plain'))).rejects.toThrow()
    await expect(
      uploadChunkedFile(createMockFile('a'.repeat(257), 'big.txt', 'text/plain'), { chunkSize: 1 })
    ).rejects.toThrow('256')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.test',
    API_BASE_URL + '/other',
    API_BASE_URL + '?token=secret',
    API_BASE_URL + '#fragment',
    '//evil.test'
  ])('rejects untrusted apiUrl %s without sending account headers', async (apiUrl) => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    await expect(
      uploadChunkedFile(createMockFile('hello', 'demo.txt', 'text/plain'), { apiUrl })
    ).rejects.toThrow('apiUrl')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the fixed API base with a trailing slash and rejects redirects', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file)
    const fileId = `${fileHash}-${file.size}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createUploadResponse({
          fileId,
          fileHash,
          totalChunks: 1,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          file: {
            fileId,
            fileHash,
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
            source: 'uploaded'
          }
        })
      )
    globalThis.fetch = fetchMock
    await uploadChunkedFile(file, { apiUrl: API_BASE_URL + '/' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toMatch(
        new RegExp('^' + API_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/upload/')
      )
      expect(init).toMatchObject({
        credentials: 'include',
        redirect: 'error',
        headers: { 'X-Account-ID': 'alice' }
      })
    }
  })

  it.each([
    { receivedIndices: [-1], receivedChunks: 1 },
    { receivedIndices: [1], receivedChunks: 1 },
    { receivedIndices: [0.5], receivedChunks: 1 },
    { receivedIndices: ['0'], receivedChunks: 1 },
    { receivedIndices: [0, 0], receivedChunks: 2 },
    { receivedIndices: [0], receivedChunks: 0 },
    { totalChunks: 2, receivedIndices: [], receivedChunks: 0 },
    { fileHash: 'different', receivedIndices: [], receivedChunks: 0 },
    { chunkSize: 2, receivedIndices: [], receivedChunks: 0 }
  ])('fails on invalid remote metadata instead of skipping chunks: %j', async (invalid) => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file)
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createUploadResponse({
        fileId: `${fileHash}-${file.size}`,
        totalChunks: 1,
        ...invalid
      })
    )
    globalThis.fetch = fetchMock
    const onProgress = vi.fn()
    await expect(uploadChunkedFile(file, { onProgress })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('does not treat a 200 null status as a missing upload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createUploadResponse(null))
    globalThis.fetch = fetchMock
    await expect(
      uploadChunkedFile(createMockFile('hello', 'demo.txt', 'text/plain'))
    ).rejects.toThrow('response')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('resumes from real server ACKs after a response is lost, ignoring stale local hints', async () => {
    const file = createMockFile('abcde', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file)
    const fileId = `${fileHash}-${file.size}`
    const remote = new Set<number>()
    const sent: number[] = []
    let loseResponse = true
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/status?')) {
        return remote.size
          ? createUploadResponse({
              fileId,
              fileHash,
              totalSize: file.size,
              chunkSize: 2,
              totalChunks: 3,
              receivedChunks: remote.size,
              receivedIndices: [...remote]
            })
          : createUploadResponse({}, 404)
      }
      if (String(url).endsWith('/chunk')) {
        const index = Number((init?.body as FormData).get('chunkIndex'))
        sent.push(index)
        remote.add(index)
        if (index === 1 && loseResponse) {
          loseResponse = false
          throw new TypeError('Network disconnected after R2 accepted the chunk')
        }
        return createUploadResponse({
          success: true,
          fileId,
          chunkIndex: index,
          receivedChunks: remote.size,
          receivedIndices: [...remote]
        })
      }
      expect(remote.size).toBe(3)
      return createUploadResponse({
        success: true,
        file: {
          fileId,
          fileHash,
          fileName: file.name,
          size: file.size,
          mimeType: file.type,
          source: 'uploaded'
        }
      })
    }) as typeof fetch
    await expect(uploadChunkedFile(file, { chunkSize: 2 })).rejects.toThrow('disconnected')
    const key = accountStorageKey('chat_upload_sessions_v1')
    expect(JSON.parse(localStorage.getItem(key)!)[fileId].uploadedChunkIndices).toEqual([0])
    const onProgress = vi.fn()
    await expect(uploadChunkedFile(file, { chunkSize: 2, onProgress })).resolves.toMatchObject({
      fileId
    })
    expect(sent).toEqual([0, 1, 2])
    expect(onProgress.mock.calls[0]?.[0]).toMatchObject({
      uploadedChunks: 2,
      percentage: 80,
      speed: 0
    })
    expect(onProgress.mock.calls[onProgress.mock.calls.length - 1]?.[0].percentage).toBe(100)
    expect(localStorage.getItem(key)).toBe('{}')
  })

  it('never deletes a failed merge, including the old offset error text', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUploadResponse({}, 404))
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          fileId,
          chunkIndex: 0,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(createUploadResponse({ error: 'offset is out of bounds' }, 500))
      .mockResolvedValueOnce(
        createUploadResponse({ fileId, totalChunks: 1, receivedChunks: 1, receivedIndices: [0] })
      )
    globalThis.fetch = fetchMock
    await expect(uploadChunkedFile(file)).rejects.toThrow('offset is out of bounds')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/delete'))).toBe(false)
    expect(
      JSON.parse(localStorage.getItem(accountStorageKey('chat_upload_sessions_v1'))!)[fileId]
    ).toMatchObject({ uploadedChunkIndices: [0] })
  })

  it('stops after one missing-chunk repair and preserves the session when merge still fails', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    const ack = { success: true, fileId, chunkIndex: 0, receivedChunks: 1, receivedIndices: [0] }
    const failure = { error: 'Incomplete upload', code: 'UPLOAD_INCOMPLETE' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUploadResponse({}, 404))
      .mockResolvedValueOnce(createUploadResponse(ack))
      .mockResolvedValueOnce(createUploadResponse(failure, 409))
      .mockResolvedValueOnce(
        createUploadResponse({ fileId, totalChunks: 1, receivedChunks: 0, receivedIndices: [] })
      )
      .mockResolvedValueOnce(createUploadResponse(ack))
      .mockResolvedValueOnce(createUploadResponse(failure, 409))
    globalThis.fetch = fetchMock
    await expect(uploadChunkedFile(file)).rejects.toThrow('Incomplete upload')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('fails explicitly on corrupt metadata and does not probe for destructive recovery', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUploadResponse({}, 404))
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          fileId,
          chunkIndex: 0,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      )
      .mockResolvedValueOnce(
        createUploadResponse({ error: 'Corrupt metadata', code: 'UPLOAD_METADATA_INVALID' }, 409)
      )
    globalThis.fetch = fetchMock
    await expect(uploadChunkedFile(file)).rejects.toThrow('Corrupt metadata')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not record invalid ACK indices or complete after them', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUploadResponse({}, 404))
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          fileId,
          chunkIndex: 0,
          receivedChunks: 2,
          receivedIndices: [0, 1]
        })
      )
    globalThis.fetch = fetchMock
    const onProgress = vi.fn()
    await expect(uploadChunkedFile(file, { onProgress })).rejects.toThrow('indices')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress.mock.calls[0]?.[0].percentage).toBe(0)
  })

  it('pins account identity across awaits and leaves the next account cache untouched', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    const otherKey = 'account:bob:chat_upload_sessions_v1'
    localStorage.setItem(otherKey, '{"preserve":"bob"}')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUploadResponse({}, 404))
      .mockImplementationOnce(async () => {
        setStorageAccount('bob')
        return createUploadResponse({
          success: true,
          fileId,
          chunkIndex: 0,
          receivedChunks: 1,
          receivedIndices: [0]
        })
      })
    globalThis.fetch = fetchMock
    await expect(uploadChunkedFile(file)).rejects.toThrow('Account changed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { 'X-Account-ID': 'alice' } })
    expect(localStorage.getItem(otherKey)).toBe('{"preserve":"bob"}')
    expect(
      JSON.parse(localStorage.getItem('account:alice:chat_upload_sessions_v1')!)[fileId]
        .uploadedChunkIndices
    ).toEqual([])
  })

  it('can resume without localStorage being writable', async () => {
    const file = createMockFile('hello', 'demo.txt', 'text/plain')
    const fileHash = await calculateFileMD5(file),
      fileId = `${fileHash}-${file.size}`
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage quota exhausted')
    })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        createUploadResponse({ fileId, totalChunks: 1, receivedChunks: 1, receivedIndices: [0] })
      )
      .mockResolvedValueOnce(
        createUploadResponse({
          success: true,
          file: {
            fileId,
            fileHash,
            fileName: file.name,
            size: file.size,
            mimeType: file.type,
            source: 'uploaded'
          }
        })
      )
    await expect(uploadChunkedFile(file)).resolves.toMatchObject({ fileId })
  })
})
