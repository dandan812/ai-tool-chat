export type Theme = 'light' | 'dark'
export type ThemePreference = Theme | 'system'

export interface ThemeOptions {
  /** 默认主题 */
  defaultTheme?: Theme
  /** 存储键名 */
  storageKey?: string
  /** 数据属性名 */
  attribute?: string
  /** 是否监听系统主题变化 */
  followSystem?: boolean
}

export const DEFAULT_THEME_OPTIONS: Required<ThemeOptions> = {
  defaultTheme: 'light',
  storageKey: 'chat_theme',
  attribute: 'data-theme',
  followSystem: true,
}

/**
 * 合并主题配置，确保所有调用方拿到完整选项。
 */
export function resolveThemeOptions(options: ThemeOptions = {}): Required<ThemeOptions> {
  return { ...DEFAULT_THEME_OPTIONS, ...options }
}

/**
 * 获取系统当前主题。
 */
export function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 读取本地存储中的主题偏好。
 */
export function readStoredTheme(storageKey: string): ThemePreference | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(storageKey) as ThemePreference | null
}

/**
 * 保存主题偏好到本地存储。
 */
export function writeStoredTheme(storageKey: string, value: ThemePreference): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, value)
}

/**
 * 计算首次加载时的主题与跟随系统状态。
 */
export function resolveInitialThemeState(
  options: Required<ThemeOptions>,
  systemTheme: Theme,
): { theme: Theme; followsSystem: boolean } {
  const savedTheme = readStoredTheme(options.storageKey)

  if (savedTheme === 'system') {
    return {
      theme: systemTheme,
      followsSystem: true,
    }
  }

  if (savedTheme) {
    return {
      theme: savedTheme,
      followsSystem: false,
    }
  }

  return {
    theme: options.followSystem ? systemTheme : options.defaultTheme,
    followsSystem: false,
  }
}

/**
 * 应用主题到文档根节点。
 */
export function applyThemeAttribute(
  attribute: string,
  value: Theme,
  withTransition: boolean = true,
): void {
  if (typeof document === 'undefined') return

  document.documentElement.setAttribute(attribute, value)

  if (!withTransition) return

  document.documentElement.classList.add('theme-transition')
  setTimeout(() => {
    document.documentElement.classList.remove('theme-transition')
  }, 300)
}
