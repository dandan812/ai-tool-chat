import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { initTheme } from './composables/useTheme'
import { isStorageAvailable, isOnline, debug, isDevelopment } from './config'
import { reportAppError } from './utils/error'
import 'element-plus/theme-chalk/base.css'
import './style.css'

if (!isStorageAvailable()) {
  console.warn('[App] LocalStorage is not available. Some features may not work.')
}
if (!isOnline()) debug.warn('[App] Application is currently offline')

if (isDevelopment) {
  window.addEventListener('load', () => {
    debug.log(`[Performance] Load event reached: ${Math.round(performance.now())}ms`)
  })
  if (window.performance && 'PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'paint') {
          debug.log(`[Performance] ${entry.name}: ${entry.startTime}ms`)
        }
      }
    })
    observer.observe({ entryTypes: ['paint'] })
  }
}

window.addEventListener('unhandledrejection', (event) => {
  reportAppError(
    event.reason instanceof Error ? event.reason : String(event.reason),
    'unhandledrejection'
  )
  event.preventDefault()
})
window.addEventListener('error', (event) => {
  reportAppError(event.error instanceof Error ? event.error : String(event.message), 'window.error')
  if (event.target && (event.target as HTMLElement).tagName) event.preventDefault()
})

const app = createApp(App)
app.config.errorHandler = (error, instance, info) => {
  const component = (instance as { type?: { __name?: string; name?: string } } | null)?.type
  reportAppError(error as Error, 'vue.errorHandler', {
    info,
    component: component?.__name || component?.name || 'anonymous'
  })
}
app.use(createPinia())
app.use(router)
initTheme()
app.mount('#app')
debug.log('[App] Application mounted successfully')
