import { API_BASE_URL } from '../config'

export interface AccountUser { id: string; username: string; guest?: boolean }
let activeAccount: string | null = null
let accountRevision = 0
export function setStorageAccount(id: string | null) {
  activeAccount = id
  accountRevision++
}
export function getAccountRevision() { return accountRevision }
export function accountHeaders(): Record<string, string> { return activeAccount ? { 'X-Account-ID': activeAccount } : {} }
export function notifyAccountChanged() { localStorage.setItem('ait_account_changed', crypto.randomUUID()) }
export function accountStorageKey(key: string): string { return 'account:' + (activeAccount ?? 'unassigned') + ':' + key }

export class APIError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.code = code
  }
}

export async function apiJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
  const revisionAtStart = accountRevision
  const ensureCurrentAccount = () => {
    if (accountRevision !== revisionAtStart) throw new APIError('账户已变化，请重新打开当前页面。', 409, 'ACCOUNT_CHANGED')
  }
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  for (const [name, value] of Object.entries(accountHeaders())) headers.set(name, value)
  const response = await fetch(API_BASE_URL + path, { ...init, credentials: 'include', headers })
  ensureCurrentAccount()
  const result = await response.json().catch(() => null)
  ensureCurrentAccount()
  if (!response.ok) {
    const code = result?.code ?? result?.error?.code
    if (response.status === 401 || code === 'ACCOUNT_CHANGED') window.dispatchEvent(new Event('account-expired'))
    const message = typeof result?.error === 'string' ? result.error : result?.error?.message
    throw new APIError(message || ('请求失败（' + response.status + '）'), response.status, code)
  }
  if (result === null) throw new APIError('服务器返回了无效的数据。', 502, 'INVALID_RESPONSE')
  return result as T
}
