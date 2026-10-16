import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockEnv } from '../test/mocks'
import { WorkerError } from '../types'
const mocks = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }))
vi.mock('../platform/accounts', () => ({
  listUserTasks: mocks.list,
  digest: async (input: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))),
      (b) => b.toString(16).padStart(2, '0')
    ).join('')
}))
vi.mock('../upload/ownedFiles', () => ({ resolveOwnedUploadedFiles: mocks.resolve }))
import { handleTaskRequest, readTaskJSON, validateTaskBody } from './taskHandlers'

const user = { id: 'user-a', username: 'alice' }
const valid = { messages: [{ role: 'user', content: 'hello' }] }
function setup() {
  const fetch = vi.fn(async (request: Request) =>
    new URL(request.url).pathname === '/replay'
      ? Response.json({ error: 'Not found' }, { status: 404 })
      : Response.json({ task: { status: 'pending' }, lastEventId: 0 }, { status: 202 })
  )
  const idFromName = vi.fn((value: string) => value)
  return {
    fetch,
    idFromName,
    env: {
      ...createMockEnv(),
      TASKS: { idFromName, get: () => ({ fetch }) } as unknown as DurableObjectNamespace,
      ACCOUNTS: {} as DurableObjectNamespace
    }
  }
}
function createRequest(body: unknown = valid, key = 'idempotency-key-001') {
  return new Request('https://api/tasks', {
    method: 'POST',
    headers: { 'Idempotency-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([])
  mocks.resolve.mockImplementation(async (_env, _user, refs) =>
    refs.map((ref: Record<string, unknown>) => ({ ...ref, fileId: 'owned-server-id' }))
  )
})

describe('task HTTP boundary', () => {
  it('permits attachment-scoped research and joint image-file questions but never image tools', () => {
    const env = createMockEnv()
    const files = [
      {
        fileId: 'file',
        fileName: 'notes.txt',
        fileHash: 'hash',
        mimeType: 'text/plain',
        size: 20,
        source: 'uploaded'
      }
    ]
    const images = [{ id: 'image', base64: 'AAAA', mimeType: 'image/png' }]
    expect(validateTaskBody({ ...valid, files, enableTools: true }, env).enableTools).toBe(true)
    expect(validateTaskBody({ ...valid, files, images }, env)).toMatchObject({
      files,
      images,
      enableTools: false
    })
    expect(() => validateTaskBody({ ...valid, files, images, enableTools: true }, env)).toThrow(
      '资料研究'
    )
  })
  it('uses a stable per-user task ID and forwards only server authenticated identity', async () => {
    const { env, idFromName, fetch } = setup()
    await handleTaskRequest(createRequest(), env, user)
    await handleTaskRequest(createRequest(), env, user)
    expect(idFromName.mock.calls[0][0]).toBe(idFromName.mock.calls[1][0])
    await handleTaskRequest(createRequest(), env, { id: 'user-b', username: 'bob' })
    expect(idFromName.mock.calls[2][0]).not.toBe(idFromName.mock.calls[0][0])
    const sent = fetch.mock.calls.find(([request]) => new URL(request.url).pathname === '/create')!
    expect(sent[0].headers.get('X-Task-Owner')).toBe(user.id)
    expect(await sent[0].json()).toMatchObject({ ownerId: user.id, request: { maxTokens: 2000 } })
  })
  it('rejects missing idempotency before forwarding execution', async () => {
    const { env, fetch } = setup()
    await expect(handleTaskRequest(createRequest(valid, ''), env, user)).rejects.toThrow(
      'Idempotency-Key'
    )
    expect(fetch).not.toHaveBeenCalled()
  })
  it('resolves uploaded file ownership before task creation and strips caller metadata', async () => {
    const { env, fetch } = setup()
    const file = {
      fileId: 'client-file',
      fileName: 'notes.txt',
      fileHash: 'hash',
      mimeType: 'text/plain',
      size: 15,
      source: 'uploaded',
      content: 'untrusted inline body'
    }
    await handleTaskRequest(
      createRequest({ ...valid, files: [file], ownerId: 'user-b' }),
      env,
      user
    )
    expect(mocks.resolve).toHaveBeenCalledWith(env, user.id, [
      expect.not.objectContaining({ content: expect.anything() })
    ])
    const sent = fetch.mock.calls.find(([request]) => new URL(request.url).pathname === '/create')!
    const payload = (await sent[0].json()) as { requestHash: string; clientRequestHash: string }
    expect(payload).toMatchObject({
      ownerId: user.id,
      request: { files: [{ fileId: 'owned-server-id' }] }
    })
    expect(payload.requestHash).not.toBe(payload.clientRequestHash)
    mocks.resolve.mockRejectedValueOnce(new WorkerError('File not found', 'NOT_FOUND', 404))
    await expect(
      handleTaskRequest(createRequest({ ...valid, files: [file] }), env, user)
    ).rejects.toThrow('File not found')
    expect(
      fetch.mock.calls.filter(([request]) => new URL(request.url).pathname === '/create')
    ).toHaveLength(1)
  })
  it('enforces actual streamed bytes even with absent or false Content-Length', async () => {
    const request = new Request('https://api/tasks', {
      method: 'POST',
      headers: { 'Content-Length': '1' },
      body: 'x'.repeat(2 * 1024 * 1024 + 1)
    })
    await expect(readTaskJSON(request)).rejects.toMatchObject({ statusCode: 413 })
    await expect(
      readTaskJSON(new Request('https://api/tasks', { method: 'POST', body: '{bad json' }))
    ).rejects.toThrow('Invalid JSON')
  })
  it('validates limits and drops unrecognized control fields instead of trusting client budgets', () => {
    const env = createMockEnv()
    const invalidBodies = [
      {},
      { messages: [] },
      { messages: Array.from({ length: 33 }, () => valid.messages[0]) },
      { messages: [{ role: 'user', content: 'x'.repeat(32001) }] },
      { messages: [{ role: 'assistant', content: 'reply' }] },
      { ...valid, temperature: -1 },
      { ...valid, maxTokens: 5000 },
      { ...valid, enableTools: true },
      { ...valid, model: 'unknown-expensive-model' },
      { ...valid, files: [{ fileId: '../other' }] },
      { ...valid, images: [{ id: 'image', mimeType: 'text/html', base64: 'AAAA' }] }
    ]
    for (const body of invalidBodies) expect(() => validateTaskBody(body, env)).toThrow()
    expect(
      validateTaskBody(
        { ...valid, maxCalls: 1000, reservedTokens: 1000000, userId: 'other', stream: true },
        env
      )
    ).toEqual({ ...valid, temperature: 0.7, maxTokens: 2000, enableTools: false })
  })
  it('lists only authenticated account tasks and forwards resume cursor without launching work', async () => {
    const { env, fetch } = setup()
    const response = await handleTaskRequest(new Request('https://api/tasks'), env, user)
    expect(await response.json()).toEqual({ tasks: [] })
    expect(mocks.list).toHaveBeenCalledWith(env, user.id)
    expect(fetch).not.toHaveBeenCalled()
    await handleTaskRequest(
      new Request(`https://api/tasks/${'a'.repeat(64)}/events?after=6`),
      env,
      user
    )
    const sent = fetch.mock.calls[0] as unknown as [Request]
    expect(sent[0].url).toBe('https://task/events?after=6')
    expect(sent[0].method).toBe('GET')
  })
  it('replays an existing task before resolving a deleted file and rejects changed client requests', async () => {
    const { env, fetch } = setup()
    let saved: { clientRequestHash: string; requestHash: string } | undefined
    let creates = 0
    fetch.mockImplementation(async (request) => {
      const body = (await request.json()) as { clientRequestHash: string; requestHash: string }
      if (new URL(request.url).pathname === '/replay') {
        if (!saved) return Response.json({ error: 'Not found' }, { status: 404 })
        return Response.json(
          { task: { id: 'original-task' }, replayed: true },
          { status: saved.clientRequestHash === body.clientRequestHash ? 202 : 409 }
        )
      }
      creates++
      saved = body
      return Response.json({ task: { id: 'original-task' } }, { status: 202 })
    })
    const body = {
      ...valid,
      files: [
        {
          fileId: 'client-file',
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          size: 15,
          fileHash: 'client-hash',
          source: 'uploaded'
        }
      ]
    }
    expect((await handleTaskRequest(createRequest(body), env, user)).status).toBe(202)
    mocks.resolve.mockRejectedValue(new WorkerError('Deleted', 'FILE_NOT_FOUND', 404))
    expect(await (await handleTaskRequest(createRequest(body), env, user)).json()).toMatchObject({
      task: { id: 'original-task' },
      replayed: true
    })
    expect(
      (await handleTaskRequest(createRequest({ ...body, temperature: 0.9 }), env, user)).status
    ).toBe(409)
    expect(mocks.resolve).toHaveBeenCalledTimes(1)
    expect(creates).toBe(1)
  })
})
