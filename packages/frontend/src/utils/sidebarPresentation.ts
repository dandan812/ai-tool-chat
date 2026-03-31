const TIME_CONSTANTS = {
  ONE_DAY: 24 * 60 * 60 * 1000,
  TWO_DAYS: 48 * 60 * 60 * 1000,
} as const

export const SIDEBAR_THEME_OPTIONS = [
  { value: 'light', label: '浅色主题' },
  { value: 'dark', label: '深色主题' },
] as const

export function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < TIME_CONSTANTS.ONE_DAY && date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  if (diff < TIME_CONSTANTS.TWO_DAYS) {
    return '昨天'
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }

  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
