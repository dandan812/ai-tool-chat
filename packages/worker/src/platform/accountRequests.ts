import type { Task } from '../types'
import type {
  BeginModelCallInput,
  CredentialsInput,
  FileLeaseIdentity,
  FileOperation,
  FinishTaskInput,
  ReserveFileInput,
  ReserveTaskInput,
  SettleModelCallInput
} from './accountTypes'
import { accountError as fail } from './accountSupport'

type FileTarget = { userId: string; fileId: string }
type LeasedFile = FileTarget & FileLeaseIdentity
export type AccountRequest =
  | { action: 'register' | 'login'; input: CredentialsInput }
  | { action: 'guest'; sessionHash: string; ipHash: string }
  | { action: 'session' | 'logout'; hash: string }
  | { action: 'reserve'; input: ReserveTaskInput }
  | { action: 'begin-call'; input: BeginModelCallInput }
  | { action: 'settle-call'; input: SettleModelCallInput }
  | { action: 'finish'; input: FinishTaskInput }
  | { action: 'usage' | 'list' | 'list-files'; userId: string }
  | { action: 'summary'; userId: string; summary: Task }
  | { action: 'reserve-file'; input: ReserveFileInput }
  | { action: 'lease-file'; input: FileTarget & { kind: FileOperation } }
  | { action: 'validate-file-lease'; input: LeasedFile & { kind: FileOperation } }
  | { action: 'end-file-lease' | 'complete-file' | 'release-file'; input: LeasedFile }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Invalid account payload')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) fail('Invalid ' + field)
  return value
}

function identifier(value: unknown, field: string): string {
  const id = text(value, field)
  // These IDs index plain-object maps in the existing storage format.
  if (['__proto__', 'constructor', 'prototype'].includes(id)) fail('Invalid ' + field)
  return id
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    fail('Invalid token budget')
  return value
}

function optionalInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : integer(value)
}

function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail('Invalid ' + field)
  return value as T
}

function fileId(value: unknown): string {
  const id = identifier(value, 'file ID')
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) fail('Invalid file ID')
  return id
}

function fileTarget(p: Record<string, unknown>): FileTarget {
  return { userId: text(p.userId, 'user ID'), fileId: fileId(p.fileId) }
}

function leasedFile(p: Record<string, unknown>): LeasedFile {
  return {
    ...fileTarget(p),
    leaseId: text(p.leaseId, 'lease ID'),
    generation: text(p.generation, 'generation')
  }
}

function operation(value: unknown): FileOperation {
  return choice(value, ['upload', 'complete', 'delete'], 'file operation')
}

function taskTarget(p: Record<string, unknown>) {
  return { userId: text(p.userId, 'user ID'), taskId: identifier(p.taskId, 'task ID') }
}

function taskSummary(value: unknown): Task {
  const p = record(value)
  if (
    typeof p.userMessage !== 'string' ||
    typeof p.createdAt !== 'number' ||
    !Number.isFinite(p.createdAt) ||
    typeof p.updatedAt !== 'number' ||
    !Number.isFinite(p.updatedAt)
  ) {
    fail('Invalid task summary')
  }
  return {
    id: identifier(p.id, 'task ID'),
    type: choice(p.type, ['chat', 'code', 'image', 'file'], 'task type'),
    status: choice(
      p.status,
      ['pending', 'running', 'completed', 'failed', 'cancelled'],
      'task status'
    ),
    userMessage: p.userMessage,
    steps: [],
    createdAt: p.createdAt,
    updatedAt: p.updatedAt
  }
}

/** Parse before entering any domain that can write storage; never coerce identities. */
export function parseAccountRequest(action: string, payload: unknown): AccountRequest {
  const p = record(payload)
  switch (action) {
    case 'guest': {
      const sessionHash = text(p.sessionHash, 'session hash')
      const ipHash = text(p.ipHash, 'IP hash')
      if (!/^[a-f0-9]{64}$/.test(sessionHash) || !/^[a-f0-9]{64}$/.test(ipHash))
        fail('Invalid guest identity')
      return { action, sessionHash, ipHash }
    }
    case 'register':
    case 'login': {
      const username = text(p.username, 'username')
      const password = text(p.password, 'password')
      if (
        !/^[a-z0-9][a-z0-9_.@+-]{2,63}$/.test(username) ||
        password.length < 12 ||
        password.length > 128
      ) {
        fail('Invalid credentials')
      }
      return {
        action,
        input: {
          username,
          password,
          sessionHash: text(p.sessionHash, 'session hash'),
          ipHash: text(p.ipHash, 'IP hash')
        }
      }
    }
    case 'session':
    case 'logout':
      return { action, hash: text(p.hash, 'session hash') }
    case 'reserve':
      return {
        action,
        input: {
          ...taskTarget(p),
          requestHash: text(p.requestHash, 'request hash'),
          reservedTokens: integer(p.reservedTokens),
          maxCalls: integer(p.maxCalls),
          maxDurationMs: integer(p.maxDurationMs)
        }
      }
    case 'begin-call':
      return {
        action,
        input: {
          ...taskTarget(p),
          callId: identifier(p.callId, 'call ID'),
          model: text(p.model, 'model'),
          estimatedInputTokens: integer(p.estimatedInputTokens),
          maxOutputTokens: integer(p.maxOutputTokens)
        }
      }
    case 'settle-call':
      return {
        action,
        input: {
          ...taskTarget(p),
          callId: identifier(p.callId, 'call ID'),
          tokenSource: choice(p.tokenSource, ['provider', 'estimated', 'unknown'], 'token source'),
          inputTokens: optionalInteger(p.inputTokens),
          outputTokens: optionalInteger(p.outputTokens),
          outcome: text(p.outcome, 'call outcome')
        }
      }
    case 'finish':
      if (typeof p.usageUnknown !== 'boolean') fail('Invalid usageUnknown')
      return {
        action,
        input: {
          ...taskTarget(p),
          status: text(p.status, 'task status'),
          usageUnknown: p.usageUnknown
        }
      }
    case 'list':
    case 'usage':
    case 'list-files':
      return { action, userId: text(p.userId, 'user ID') }
    case 'summary':
      return { action, userId: text(p.userId, 'user ID'), summary: taskSummary(p.summary) }
    case 'reserve-file': {
      let metadata: ReserveFileInput['metadata']
      if (p.metadata !== undefined) {
        const source = record(p.metadata)
        for (const field of ['externalFileId', 'fileName', 'mimeType']) {
          if (source[field] !== undefined && typeof source[field] !== 'string')
            fail('Invalid file metadata')
        }
        metadata = {
          externalFileId: source.externalFileId ? fileId(source.externalFileId) : undefined,
          fileName: source.fileName as string | undefined,
          mimeType: source.mimeType as string | undefined
        }
      }
      return { action, input: { ...fileTarget(p), bytes: integer(p.bytes), metadata } }
    }
    case 'lease-file':
      return { action, input: { ...fileTarget(p), kind: operation(p.kind) } }
    case 'validate-file-lease':
      return { action, input: { ...leasedFile(p), kind: operation(p.kind) } }
    case 'end-file-lease':
    case 'complete-file':
    case 'release-file':
      return { action, input: leasedFile(p) }
    default:
      fail('Unknown account action')
  }
}
