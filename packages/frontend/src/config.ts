/** Development uses the Vite proxy; deployments may override the API origin. */
export const API_BASE_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api' : 'https://api.i-tool-chat.store')

export const STORAGE_KEYS = {
  SESSION_LIST: 'chat_session_list',
  MESSAGES_MAP: 'chat_messages_map',
  CURRENT_SESSION_ID: 'chat_current_session_id',
  THEME: 'chat_theme'
} as const

export const MAX_IMAGES = 4
export const isDevelopment = import.meta.env.DEV

export const debug = {
  log: (...args: unknown[]) => {
    if (isDevelopment) console.log('[App]', ...args)
  },
  warn: (...args: unknown[]) => {
    if (isDevelopment) console.warn('[App]', ...args)
  }
}

export function isStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__'
    localStorage.setItem(testKey, 'test')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine
}
