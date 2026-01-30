import { ref, onMounted } from 'vue'

/**
 * 主题管理 Composable
 * 支持手动切换和系统主题自动适配
 */

type Theme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'chat_theme'
const THEME_ATTRIBUTE = 'data-theme'

/**
 * 检测系统首选主题
 */
function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * 从本地存储加载主题设置
 */
function loadSavedTheme(): Theme | null {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
  return saved === 'light' || saved === 'dark' ? saved : null
}

/**
 * 应用主题到文档
 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
}

export function useTheme() {
  const theme = ref<Theme>('light')

  /**
   * 切换主题
   */
  function setTheme(newTheme: Theme): void {
    theme.value = newTheme
    applyTheme(newTheme)
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)
  }

  /**
   * 切换主题（切换按钮用）
   */
  function toggleTheme(): void {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  /**
   * 初始化主题
   * 优先级：本地存储 > 系统设置 > 默认 light
   */
  onMounted(() => {
    const savedTheme = loadSavedTheme()
    const initialTheme = savedTheme ?? getSystemTheme()

    theme.value = initialTheme
    applyTheme(initialTheme)

    // 监听系统主题变化（当用户没有手动设置时）
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', (e) => {
      if (!loadSavedTheme()) {
        const newTheme = e.matches ? 'dark' : 'light'
        theme.value = newTheme
        applyTheme(newTheme)
      }
    })
  })

  return {
    theme,
    setTheme,
    toggleTheme
  }
}
