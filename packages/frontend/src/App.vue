<script setup lang="ts">
/**
 * 应用根组件
 *
 * 这是应用的顶层组件，负责：
 * 1. 渲染路由视图（由 Router 决定显示哪个页面）
 * 2. 提供全局布局容器
 * 3. 注入全局样式和主题
 *
 * @package frontend/src
 */

import { RouterView } from 'vue-router'
import { onMounted } from 'vue'
import { isOnline, debug } from './config'
import { useChatStore } from './stores/chat'

const chatStore = useChatStore()

/**
 * 组件挂载时的初始化操作
 */
onMounted(() => {
  debug.log('[App] Root component mounted')
  chatStore.resetTransientState()

  /**
   * 监听网络状态变化
   * 可以根据在线/离线状态显示不同的 UI
   */
  window.addEventListener('online', () => {
    debug.log('[App] Network status: online')
  })

  window.addEventListener('offline', () => {
    debug.warn('[App] Network status: offline')
  })

  // 添加网络状态类到 body
  if (isOnline()) {
    document.body.classList.add('online')
    document.body.classList.remove('offline')
  } else {
    document.body.classList.add('offline')
    document.body.classList.remove('online')
  }

  /**
   * 处理可见性变化
   * 用户切换标签页时可以暂停某些操作
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      debug.log('[App] Page hidden')
    } else {
      debug.log('[App] Page visible')
    }
  })
})
</script>

<template>
  <!--
    RouterView 组件会根据当前路由渲染对应的组件
    这是 Vue Router 的核心功能
  -->
  <RouterView />
</template>
