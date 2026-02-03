import { ref, onMounted, onUnmounted, readonly } from 'vue'

/**
 * 主题管理 Composable - 优化版
 * 支持手动切换、系统主题自动适配、持久化存储
 */

type Theme = 'light' | 'dark'

interface UseThemeOptions {
  /** 默认主题 */
  defaultTheme?: Theme
  /** 存储键名 */
  storageKey?: string
  /** 数据属性名 */
  attribute?: string
  /** 是否监听系统主题变化 */
  followSystem?: boolean
}

const DEFAULT_OPTIONS: Required<UseThemeOptions> = {
  defaultTheme: 'light',
  storageKey: 'chat_theme',
  attribute: 'data-theme',
  followSystem: true
}

/**
 * 获取系统首选主题
 */
function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 创建主题管理器
 */
export function useTheme(options: UseThemeOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  const theme = ref<Theme>(opts.defaultTheme)
  const systemTheme = ref<Theme>('light')
  const isFollowingSystem = ref(false)
  
  let mediaQuery: MediaQueryList | null = null
  let unsubscribe: (() => void) | null = null

  /**
   * 应用主题到文档
   */
  function applyTheme(value: Theme): void {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute(opts.attribute, value)
    
    // 添加过渡类，实现平滑过渡
    document.documentElement.classList.add('theme-transition')
    setTimeout(() => {
      document.documentElement.classList.remove('theme-transition')
    }, 300)
  }

  /**
   * 保存主题到本地存储
   */
  function saveTheme(value: Theme | 'system'): void {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(opts.storageKey, value)
  }

  /**
   * 从本地存储加载主题
   */
  function loadTheme(): Theme | 'system' | null {
    if (typeof localStorage === 'undefined') return null
    const saved = localStorage.getItem(opts.storageKey) as Theme | 'system' | null
    return saved
  }

  /**
   * 设置主题
   */
  function setTheme(value: Theme | 'system'): void {
    if (value === 'system') {
      isFollowingSystem.value = true
      const sysTheme = getSystemTheme()
      theme.value = sysTheme
      systemTheme.value = sysTheme
      applyTheme(sysTheme)
      saveTheme('system')
    } else {
      isFollowingSystem.value = false
      theme.value = value
      applyTheme(value)
      saveTheme(value)
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
    
    const savedTheme = loadTheme()
    
    if (savedTheme === 'system') {
      isFollowingSystem.value = true
      theme.value = systemTheme.value
    } else if (savedTheme) {
      theme.value = savedTheme
    } else {
      // 未保存过，尝试跟随系统
      theme.value = opts.followSystem ? systemTheme.value : opts.defaultTheme
    }
    
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
export function initTheme(options: UseThemeOptions = {}): void {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  if (typeof document === 'undefined') return
  
  const saved = localStorage.getItem(opts.storageKey) as Theme | 'system' | null
  let theme: Theme
  
  if (saved === 'system' || !saved) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } else {
    theme = saved
  }
  
  document.documentElement.setAttribute(opts.attribute, theme)
}
