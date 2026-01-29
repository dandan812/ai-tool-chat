import { ref, onMounted } from 'vue'

export function useTheme() {
  const theme = ref<'light' | 'dark'>('light')

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    theme.value = newTheme
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('chat_theme', newTheme)
  }

  // 初始化主题
  onMounted(() => {
    const savedTheme = localStorage.getItem('chat_theme') as 'light' | 'dark' | null
    if (savedTheme) {
      theme.value = savedTheme
      document.documentElement.setAttribute('data-theme', savedTheme)
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme.value = 'dark'
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      theme.value = 'light'
      document.documentElement.setAttribute('data-theme', 'light')
    }
  })

  return {
    theme,
    handleThemeChange
  }
}
