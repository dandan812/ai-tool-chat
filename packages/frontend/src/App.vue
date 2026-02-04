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

/**
 * 组件挂载时的初始化操作
 */
onMounted(() => {
  debug.log('[App] Root component mounted')

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

<style>
/* ==================== 全局样式 ==================== */

/**
 * 应用基础样式
 * 大部分样式在 style.css 中定义
 * 这里只保留必要的覆盖或特殊情况
 */

/* 消除默认边距和内边距 */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
}

/* 确保 #app 根元素占满屏幕 */
#app {
  width: 100%;
  height: 100%;
}

/* ==================== 离线状态样式 ==================== */

/**
 * 当应用离线时，可以显示特殊样式或提示
 */
body.offline {
  /* 可以在这里添加离线状态的视觉提示 */
  /* 例如：顶部的灰色条或图标 */
}

/* ==================== 滚动条样式 ====================

/**
 * 自定义滚动条样式
 * 使用 CSS 变量，可根据主题自动调整
 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-elevated);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
  transition: background var(--transition-fast);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* ==================== 选中文本样式 ====================

/**
 * 自定义文本选中的背景色
 */
::selection {
  background: var(--accent-primary);
  color: white;
}

::-moz-selection {
  background: var(--accent-primary);
  color: white;
}

/* ==================== 焦点样式 ====================

/**
 * 所有可聚焦元素的自定义焦点样式
 */
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* ==================== 动画相关 ====================

/**
 * 禁用某些用户选择动画，提升体验
 */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
</style>
