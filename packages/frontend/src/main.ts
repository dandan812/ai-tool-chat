/**
 * Vue 应用入口文件
 *
 * 负责初始化 Vue 应用、注册插件和全局配置
 *
 * @package frontend/src
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { initTheme } from './composables/useTheme'
import { isStorageAvailable, isOnline, debug, isDevelopment } from './config'

// ==================== 样式导入 ====================

/**
 * 导入全局样式
 * CSS 变量和基础样式
 */
import './style.css'

// ==================== 应用配置 ====================

import App from './App.vue'
import router from './router'

// ==================== 环境检查 ====================

/**
 * 检查 LocalStorage 是否可用
 * 不可用时显示警告
 */
if (!isStorageAvailable()) {
  console.warn('[App] LocalStorage is not available. Some features may not work.')
}

/**
 * 检查网络状态
 */
if (!isOnline()) {
  debug.warn('[App] Application is currently offline')
}

// ==================== 性能监控 ====================

/**
 * 开发环境下启用性能监控
 */
if (isDevelopment) {
  // 页面加载时间
  window.addEventListener('load', () => {
    const timing = performance.timing
    if (timing) {
      const pageLoadTime = timing.loadEventEnd - timing.navigationStart
      debug.log(`[Performance] Page load time: ${pageLoadTime}ms`)
    }
  })

  // 首次内容绘制时间
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

// ==================== 全局错误处理 ====================

/**
 * 捕获未处理的 Promise 拒绝
 */
window.addEventListener('unhandledrejection', (event) => {
  console.error('[App] Unhandled Promise rejection:', event.reason)
  // 阻止默认的控制台错误输出
  event.preventDefault()

  // 开发环境下可以在这里显示错误通知
  if (isDevelopment) {
    // TODO: 添加错误通知 UI
  }
})

/**
 * 捕获全局错误
 */
window.addEventListener('error', (event) => {
  console.error('[App] Global error:', event.error)

  // 防止加载错误（如脚本、图片加载失败）影响应用运行
  if (event.target && (event.target as HTMLElement).tagName) {
    event.preventDefault()
  }
})

// ==================== Vue 应用初始化 ====================

/**
 * 创建 Vue 应用实例
 */
const app = createApp(App)

/**
 * 注册 Pinia 状态管理
 */
app.use(createPinia())

/**
 * 注册 Vue Router 路由
 */
app.use(router)

/**
 * 初始化主题（非阻塞）
 * 防止主题闪烁
 */
initTheme()

// ==================== 挂载应用 ====================

/**
 * 挂载应用到 DOM
 */
app.mount('#app')

// ==================== 应用启动完成 ====================

debug.log('[App] Application mounted successfully')

/**
 * 可以在这里注册 Service Worker、PWA 等
 */
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/sw.js')
//     .then(() => console.log('[App] Service Worker registered'))
//     .catch((err) => console.error('[App] Service Worker registration failed:', err))
// }
