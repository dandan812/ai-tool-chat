import { accountHeaders } from '../../api/account'
import { API_BASE_URL } from '../../config'
import type { UploadedFileRef } from '../../types/task'
import type { UploadPlan } from './file'

type JSONObject = Record<string, unknown>

function object(value: unknown): JSONObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid upload response')
  }
  return value as JSONObject
}

export function parseReceivedIndices(
  value: unknown,
  totalChunks: number,
  count: unknown
): Set<number> {
  if (
    !Array.isArray(value) ||
    !Number.isSafeInteger(count) ||
    count !== value.length ||
    value.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= totalChunks) ||
    new Set(value).size !== value.length
  ) {
    throw new Error('Invalid upload chunk indices')
  }
  return new Set(value as number[])
}

function checkIdentity(data: JSONObject, plan: UploadPlan): void {
  if (
    data.fileId !== plan.fileId ||
    (data.fileHash !== undefined && data.fileHash !== plan.fileHash) ||
    (data.totalSize !== undefined && data.totalSize !== plan.file.size) ||
    (data.totalChunks !== undefined && data.totalChunks !== plan.totalChunks) ||
    (data.chunkSize !== undefined && data.chunkSize !== plan.chunkSize)
  ) {
    throw new Error('Upload metadata does not match this file or chunk layout')
  }
}

export class UploadHTTPError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class UploadTransportError extends Error {}
const STATUS_NOT_FOUND = Symbol('upload not found')

function fixedAPIBase(apiUrl?: string): string {
  if (apiUrl !== undefined && typeof apiUrl !== 'string') throw new Error('Invalid apiUrl')
  const configured = new URL(API_BASE_URL, window.location.href)
  const candidate = new URL(apiUrl ?? API_BASE_URL, window.location.href)
  const normalizePath = (path: string) => path.replace(/\/+$/, '')
  if (
    !['http:', 'https:'].includes(configured.protocol) ||
    candidate.origin !== configured.origin ||
    normalizePath(candidate.pathname) !== normalizePath(configured.pathname) ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash
  ) {
    throw new Error('apiUrl must be the configured upload API base URL')
  }
  return configured.origin + normalizePath(configured.pathname)
}

export function createUploadHTTP(apiUrl: string | undefined, assertAccount: () => void) {
  const baseUrl = fixedAPIBase(apiUrl)
  const headers = { ...accountHeaders() }
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    assertAccount()
    let response: Response
    try {
      response = await fetch(baseUrl + path, {
        ...init,
        credentials: 'include',
        redirect: 'error',
        headers: {
          ...headers,
          ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {})
        }
      })
    } catch (error) {
      assertAccount()
      throw new UploadTransportError(
        error instanceof Error ? error.message : 'Upload network request failed'
      )
    }
    assertAccount()
    if (response.status === 404 && path.startsWith('/upload/status?')) return STATUS_NOT_FOUND
    const data: unknown = await response.json().catch(() => null)
    assertAccount()
    if (!response.ok) {
      const body = data && typeof data === 'object' ? (data as JSONObject) : {}
      const nested = body.error && typeof body.error === 'object' ? (body.error as JSONObject) : {}
      const code =
        typeof body.code === 'string'
          ? body.code
          : typeof nested.code === 'string'
            ? nested.code
            : undefined
      if (response.status === 401 || code === 'ACCOUNT_CHANGED') {
        window.dispatchEvent(new Event('account-expired'))
      }
      const message =
        typeof body.error === 'string'
          ? body.error
          : typeof nested.message === 'string'
            ? nested.message
            : `Upload request failed (${response.status})`
      throw new UploadHTTPError(message, response.status, code)
    }
    return data
  }
  return {
    async status(plan: UploadPlan): Promise<Set<number> | null> {
      const result = await request(
        '/upload/status?fileId=' + encodeURIComponent(plan.fileId) + '&chunkSize=' + plan.chunkSize
      )
      if (result === STATUS_NOT_FOUND) return null
      const data = object(result)
      checkIdentity(data, plan)
      if (data.totalChunks !== plan.totalChunks) throw new Error('Invalid upload totalChunks')
      return parseReceivedIndices(data.receivedIndices, plan.totalChunks, data.receivedChunks)
    },
    async chunk(plan: UploadPlan, index: number): Promise<Set<number>> {
      const chunk = plan.file.slice(
        index * plan.chunkSize,
        Math.min((index + 1) * plan.chunkSize, plan.file.size)
      )
      const data = new FormData()
      const values = {
        fileId: plan.fileId,
        fileHash: plan.fileHash,
        fileName: plan.file.name,
        fileSize: String(plan.file.size),
        chunkIndex: String(index),
        totalChunks: String(plan.totalChunks),
        chunkSize: String(plan.chunkSize),
        mimeType: plan.file.type || 'text/plain'
      }
      for (const [key, value] of Object.entries(values)) data.append(key, value)
      data.append('chunk', new Blob([await chunk.arrayBuffer()], { type: values.mimeType }))
      const result = object(await request('/upload/chunk', { method: 'POST', body: data }))
      checkIdentity(result, plan)
      const indices = parseReceivedIndices(
        result.receivedIndices,
        plan.totalChunks,
        result.receivedChunks
      )
      if (result.success !== true || result.chunkIndex !== index || !indices.has(index)) {
        throw new Error('Server did not acknowledge the uploaded chunk')
      }
      return indices
    },
    async complete(plan: UploadPlan): Promise<UploadedFileRef> {
      const result = object(
        await request('/upload/complete', {
          method: 'POST',
          body: JSON.stringify({
            fileId: plan.fileId,
            fileHash: plan.fileHash,
            fileName: plan.file.name,
            mimeType: plan.file.type || 'text/plain'
          })
        })
      )
      const file = object(result.file)
      checkIdentity(file, plan)
      if (
        result.success !== true ||
        file.size !== plan.file.size ||
        file.fileHash !== plan.fileHash ||
        typeof file.fileName !== 'string' ||
        typeof file.mimeType !== 'string' ||
        file.source !== 'uploaded'
      ) {
        throw new Error('Invalid completed upload reference')
      }
      return file as unknown as UploadedFileRef
    }
  }
}
