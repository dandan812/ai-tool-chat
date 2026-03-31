import { ref, onMounted, onUnmounted, readonly } from 'vue'
import {
  applyThemeAttribute,
  getSystemTheme,
  readStoredTheme,
  resolveInitialThemeState,
  resolveThemeOptions,
  writeStoredTheme,
  type Theme,
  type ThemeOptions,
  type ThemePreference,
} from '../utils/themeCore'

/**
 * 主题管理 Composable - 优化版
 * 支持手动切换、系统主题自动适配、持久化存储
 */

/**
 * 创建主题管理器
 */
export function useTheme(options: ThemeOptions = {}) {
  const opts = resolveThemeOptions(options)
  
  const theme = ref<Theme>(opts.defaultTheme)
  const systemTheme = ref<Theme>('light')
  const isFollowingSystem = ref(false)
  
  let mediaQuery: MediaQueryList | null = null
  let unsubscribe: (() => void) | null = null

  /**
   * 应用主题到文档
   */
  function applyTheme(value: Theme): void {
    applyThemeAttribute(opts.attribute, value)
  }

  /**
   * 设置主题
   */
  function setTheme(value: ThemePreference): void {
    if (value === 'system') {
      isFollowingSystem.value = true
      const sysTheme = getSystemTheme()
      theme.value = sysTheme
      systemTheme.value = sysTheme
      applyTheme(sysTheme)
      writeStoredTheme(opts.storageKey, 'system')
    } else {
      isFollowingSystem.value = false
      theme.value = value
      applyTheme(value)
      writeStoredTheme(opts.storageKey, value)
    }
  }

  /**
   * 切换主题
   */
  function toggleTheme(): void {
    const newTheme = theme.value === 'light' ? 'dark' : 'light'
    setTheme(newTheme)
  }

  /**
   * 跟随系统主题
   */
  function followSystem(): void {
    setTheme('system')
  }

  /**
   * 监听系统主题变化
   */
  function setupSystemListener(): void {
    if (!opts.followSystem || typeof window === 'undefined') return
    
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handler = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? 'dark' : 'light'
      systemTheme.value = newTheme
      
      // 只在跟随系统模式时自动切换
      if (isFollowingSystem.value) {
        theme.value = newTheme
        applyTheme(newTheme)
      }
    }

    // 保存取消订阅函数
    unsubscribe = () => mediaQuery?.removeEventListener('change', handler)
    
    mediaQuery.addEventListener('change', handler)
  }

  // ==================== 生命周期 ====================

  onMounted(() => {
    systemTheme.value = getSystemTheme()

    const initialState = resolveInitialThemeState(opts, systemTheme.value)
    theme.value = initialState.theme
    isFollowingSystem.value = initialState.followsSystem
    
    applyTheme(theme.value)
    setupSystemListener()
  })

  onUnmounted(() => {
    unsubscribe?.()
  })

  return {
    // 状态（readonly 防止外部直接修改）
    theme: readonly(theme),
    systemTheme: readonly(systemTheme),
    isFollowingSystem: readonly(isFollowingSystem),
    
    // 方法
    setTheme,
    toggleTheme,
    followSystem,
    
    // 工具
    isDark: () => theme.value === 'dark'
  }
}

/**
 * 初始化主题（用于非 Vue 环境或提前设置）
 */
export function initTheme(options: ThemeOptions = {}): void {
  const opts = resolveThemeOptions(options)
  
  if (typeof document === 'undefined') return

  const saved = readStoredTheme(opts.storageKey)
  const initialTheme =
    saved && saved !== 'system'
      ? saved
      : getSystemTheme()

  applyThemeAttribute(opts.attribute, initialTheme, false)
}
