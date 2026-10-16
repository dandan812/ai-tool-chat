import { describe, expect, it, vi } from 'vitest'
import { ChunkStorage } from './chunkStorage'
import {
  ownedFileId,
  reserveFile,
  resolveOwnedUploadedFiles,
  acquireFileLease,
  releaseFile,
  fileLeaseHeaders
} from './ownedFiles'
import { getUploadedFileContent, getUploadedFileChunkObjectKey } from './uploadedFileStorage'
import { digest } from '../platform/accounts'

import {
  handleUploadChunk,
  handleUploadComplete,
  handleUploadDelete,
  handleUploadStatus
} from '../handlers/uploadHandlers'
import { AccountDirectory, listUserFiles } from '../platform/accounts'
import { createMockEnv, MemoryDurableObjectState } from '../test/mocks'
function setup() {
  const env = createMockEnv()
  const chunks = new Map<string, ChunkStorage>()
  const state = new MemoryDurableObjectState()
  const accountState = Object.assign(state, {
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => fn()
  })
  const accounts = new AccountDirectory(accountState as unknown as DurableObjectState, env)
  env.ACCOUNTS = {
    idFromName: (id: string) => id,
    get: () => accounts
  } as unknown as DurableObjectNamespace
  env.CHUNK_STORAGE = {
    idFromName: (id: string) => id,
    get: (id: string) => {
      if (!chunks.has(id))
        chunks.set(
          id,
          new ChunkStorage(new MemoryDurableObjectState() as unknown as DurableObjectState, env)
        )
      return {
        fetch: (request: Request | string) =>
          chunks.get(id)!.fetch(typeof request === 'string' ? new Request(request) : request)
      }
    }
  } as unknown as DurableObjectNamespace
  return env
}
function form(overrides: Record<string, string> = {}) {
  const data = new FormData()
  const values = {
    fileId: 'same-file',
    fileName: 'original.txt',
    fileHash: 'test-hash',
    fileSize: '5',
    chunkIndex: '0',
    totalChunks: '1',
    mimeType: 'text/plain',
    ...overrides
  }
  for (const [key, value] of Object.entries(values)) data.append(key, value)
  data.append('chunk', new File(['hello'], 'original.txt', { type: 'text/plain' }))
  return data
}
const upload = (data: FormData) =>
  new Request('https://app.test/upload/chunk', {
    method: 'POST',
    headers: { origin: 'https://app.test' },
    body: data
  })
const complete = () =>
  new Request('https://app.test/upload/complete', {
    method: 'POST',
    headers: { origin: 'https://app.test', 'content-type': 'application/json' },
    body: JSON.stringify({ fileId: 'same-file', fileName: 'spoofed.txt' })
  })
describe('Owned file boundary', () => {
  it('retains quota and deletion manifest after partial cleanup failure until retry succeeds', async () => {
    const env = setup()
    await handleUploadChunk(upload(form()), env, 'alice')
    await handleUploadComplete(complete(), env, 'alice')
    const originalDelete = env.UPLOADED_FILES.delete.bind(env.UPLOADED_FILES)
    let failOnce = true
    vi.spyOn(env.UPLOADED_FILES, 'delete').mockImplementation(
      async (...args: Parameters<typeof env.UPLOADED_FILES.delete>) => {
        if (failOnce && String(args[0]).startsWith('uploaded-files/')) {
          failOnce = false
          throw new Error('simulated R2 interruption')
        }
        return originalDelete(...args)
      }
    )
    const deletion = () =>
      handleUploadDelete(
        new Request('https://app.test/upload/delete?fileId=same-file', {
          method: 'POST',
          headers: { origin: 'https://app.test' }
        }),
        env,
        'alice'
      )
    await expect(deletion()).rejects.toThrow()
    expect(await listUserFiles(env, 'alice')).toHaveLength(1)
    await expect(handleUploadChunk(upload(form()), env, 'alice')).rejects.toMatchObject({
      statusCode: 409
    })
    expect((await deletion()).status).toBe(200)
    expect(await listUserFiles(env, 'alice')).toEqual([])
    expect(
      await env.UPLOADED_FILES.head('uploaded-files/' + (await ownedFileId('alice', 'same-file')))
    ).toBeNull()
  })
  it('blocks deletion while an R2 write is pending and retry removes every byte and quota', async () => {
    const env = setup()
    await handleUploadChunk(upload(form({ fileSize: '10', totalChunks: '2' })), env, 'alice')
    const bucket = env.UPLOADED_FILES
    const original = bucket.put.bind(bucket)
    let unblock!: () => void
    let arrived!: () => void
    const gate = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const arrival = new Promise<void>((resolve) => {
      arrived = resolve
    })
    vi.spyOn(bucket, 'put').mockImplementation(async (...args: Parameters<typeof bucket.put>) => {
      if (String(args[0]).endsWith('/1')) {
        arrived()
        await gate
      }
      return original(...args)
    })
    const inflight = handleUploadChunk(
      upload(form({ fileSize: '10', totalChunks: '2', chunkIndex: '1' })),
      env,
      'alice'
    )
    await arrival
    const deletion = () =>
      handleUploadDelete(
        new Request('https://app.test/upload/delete?fileId=same-file', {
          method: 'POST',
          headers: { origin: 'https://app.test' }
        }),
        env,
        'alice'
      )
    try {
      await expect(deletion()).rejects.toMatchObject({ statusCode: 409 })
      expect(await listUserFiles(env, 'alice')).toHaveLength(1)
    } finally {
      unblock()
    }
    expect((await inflight).status).toBe(200)
    expect((await deletion()).status).toBe(200)
    expect(await listUserFiles(env, 'alice')).toEqual([])
    const internal = await ownedFileId('alice', 'same-file')
    expect(await bucket.head(getUploadedFileChunkObjectKey(internal, 0))).toBeNull()
    expect(await bucket.head(getUploadedFileChunkObjectKey(internal, 1))).toBeNull()
  })
  it('expired lease permits cleanup but a stale request cannot write or release a new generation', async () => {
    const env = setup(),
      internal = await ownedFileId('alice', 'same-file')
    await reserveFile(env, 'alice', internal, 5, {
      externalFileId: 'same-file',
      fileName: 'original.txt',
      mimeType: 'text/plain'
    })
    const oldLease = await acquireFileLease(env, 'alice', internal, 'upload')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120001)
    try {
      expect((await listUserFiles(env, 'alice'))[0].bytes).toBe(5)
      await expect(acquireFileLease(env, 'alice', internal, 'upload')).rejects.toMatchObject({
        statusCode: 409
      })
      const deletion = await handleUploadDelete(
        new Request('https://app.test/upload/delete?fileId=same-file', {
          method: 'POST',
          headers: { origin: 'https://app.test' }
        }),
        env,
        'alice'
      )
      expect(deletion.status).toBe(200)
      await handleUploadChunk(upload(form()), env, 'alice')
      await expect(releaseFile(env, 'alice', internal, oldLease)).rejects.toMatchObject({
        statusCode: 409
      })
      const staleForm = form()
      staleForm.set('fileId', internal)
      const lateResponse = await env.CHUNK_STORAGE.get(
        env.CHUNK_STORAGE.idFromName(internal)
      ).fetch(
        new Request('https://chunk-storage/?action=storeChunk&fileId=' + internal, {
          method: 'POST',
          headers: fileLeaseHeaders('alice', internal, oldLease),
          body: staleForm
        })
      )
      expect(lateResponse.status).toBe(409)
      expect(await listUserFiles(env, 'alice')).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })
  it('binds task refs to server SHA-256 and rejects replaced or unversioned objects', async () => {
    const env = setup()
    await handleUploadChunk(upload(form()), env, 'alice')
    const finished = (await (await handleUploadComplete(complete(), env, 'alice')).json()) as {
      file: never
    }
    const [oldRef] = await resolveOwnedUploadedFiles(env, 'alice', [finished.file])
    expect(oldRef.fileHash).toBe(await digest('hello'))
    expect((await getUploadedFileContent(env, oldRef)).content).toBe('hello')
    await handleUploadDelete(
      new Request('https://app.test/upload/delete?fileId=same-file', {
        method: 'POST',
        headers: { origin: 'https://app.test' }
      }),
      env,
      'alice'
    )
    const changed = form({ fileHash: 'new-client-hash' })
    changed.set('chunk', new File(['other'], 'original.txt'))
    await handleUploadChunk(upload(changed), env, 'alice')
    await handleUploadComplete(complete(), env, 'alice')
    await expect(getUploadedFileContent(env, oldRef)).rejects.toMatchObject({
      statusCode: 410,
      code: 'FILE_VERSION_CHANGED'
    })
    const [newRef] = await resolveOwnedUploadedFiles(env, 'alice', [finished.file])
    expect(newRef.fileHash).toBe(await digest('other'))
    await env.UPLOADED_FILES.put('uploaded-files/' + newRef.fileId, 'legacy body')
    await expect(getUploadedFileContent(env, newRef)).rejects.toMatchObject({ statusCode: 410 })
  })
  it('lists only external IDs owned by the current user and duplicate uploads do not double reserve', async () => {
    const env = setup()
    await handleUploadChunk(upload(form()), env, 'alice')
    await handleUploadChunk(upload(form()), env, 'alice')
    const files = await listUserFiles(env, 'alice')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      fileId: 'same-file',
      bytes: 5,
      fileName: 'original.txt',
      status: 'uploading'
    })
    expect(JSON.stringify(files)).not.toContain('owned-')
    expect(await listUserFiles(env, 'bob')).toEqual([])
    await handleUploadComplete(complete(), env, 'alice')
    expect((await listUserFiles(env, 'alice'))[0].status).toBe('complete')
  })
  it('lists expired incomplete uploads and deleting them releases capacity without changing other users', async () => {
    const env = setup()
    env.MAX_USER_FILE_BYTES = '5'
    await handleUploadChunk(upload(form()), env, 'alice')
    await handleUploadChunk(upload(form()), env, 'bob')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400001)
    try {
      expect((await listUserFiles(env, 'alice'))[0].status).toBe('expired')
      await handleUploadDelete(
        new Request('https://app.test/upload/delete?fileId=same-file', {
          method: 'POST',
          headers: { origin: 'https://app.test' }
        }),
        env,
        'alice'
      )
      expect(await listUserFiles(env, 'alice')).toEqual([])
      expect(await listUserFiles(env, 'bob')).toHaveLength(1)
      await handleUploadChunk(upload(form({ fileId: 'new-file' })), env, 'alice')
      expect((await listUserFiles(env, 'alice'))[0].fileId).toBe('new-file')
    } finally {
      clock.mockRestore()
    }
  })
  it('isolates equal client IDs, rejects traversal and does not use names as authority', async () => {
    expect(await ownedFileId('a', 'same-file')).not.toBe(await ownedFileId('b', 'same-file'))
    await expect(ownedFileId('a', '../escape')).rejects.toThrow()
    const env = setup()
    const result = await handleUploadChunk(upload(form()), env, 'a')
    expect(((await result.json()) as { fileId: string }).fileId).toBe('same-file')
    const finished = await handleUploadComplete(complete(), env, 'a')
    const file = ((await finished.json()) as { file: { fileId: string; fileName: string } }).file
    expect(file.fileId).toBe('same-file')
    expect(file.fileName).toBe('original.txt')
    expect(
      (
        await handleUploadStatus(
          new Request('https://app.test/upload/status?fileId=same-file'),
          env,
          'b'
        )
      ).status
    ).toBe(404)
    await expect(resolveOwnedUploadedFiles(env, 'b', [file as never])).rejects.toMatchObject({
      statusCode: 404
    })
    const resolved = await resolveOwnedUploadedFiles(env, 'a', [
      { ...file, fileName: 'spoofed.txt' } as never
    ])
    expect(resolved[0].fileName).toBe('original.txt')
    expect(resolved[0].fileId).toBe(await ownedFileId('a', 'same-file'))
  })
  it('rejects GET deletion and cross-origin writes before modifying storage', async () => {
    const env = setup()
    await expect(
      handleUploadDelete(new Request('https://app.test/upload/delete?fileId=same-file'), env, 'a')
    ).rejects.toMatchObject({ statusCode: 405 })
    await expect(
      handleUploadChunk(
        new Request('https://app.test/upload/chunk', {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: form()
        }),
        env,
        'a'
      )
    ).rejects.toMatchObject({ statusCode: 403 })
  })
  it('validates integer bounds, real chunk bytes and immutable upload metadata', async () => {
    for (const invalid of [
      { chunkIndex: '-1' },
      { chunkIndex: '0.5' },
      { totalChunks: '257' },
      { fileSize: '3' }
    ]) {
      const env = setup()
      await expect(handleUploadChunk(upload(form(invalid)), env, 'a')).rejects.toThrow()
    }
    const env = setup()
    await handleUploadChunk(upload(form({ fileSize: '10', totalChunks: '2' })), env, 'a')
    await expect(
      handleUploadChunk(
        upload(
          form({ fileSize: '10', totalChunks: '2', chunkIndex: '1', fileName: 'changed.txt' })
        ),
        env,
        'a'
      )
    ).rejects.toThrow()
  })
  it('reserves account file capacity idempotently and separates quotas by account', async () => {
    const env = setup()
    env.MAX_USER_FILE_BYTES = '10'
    await reserveFile(env, 'a', 'one', 8)
    await reserveFile(env, 'a', 'one', 8)
    await expect(reserveFile(env, 'a', 'two', 8)).rejects.toMatchObject({ statusCode: 413 })
    await expect(reserveFile(env, 'b', 'two', 8)).resolves.toEqual({})
  })
})
