/**
 * Vue Router 路由配置
 *
 * 负责应用的路由管理和导航
 *
 * 功能特性：
 * - History 模式路由（支持浏览器前进/后退）
 * - 路由懒加载支持
 * - 导航守卫（待添加）
 *
 * @package frontend/src/router
 */

import { createRouter, createWebHistory } from 'vue-router'
import Chat from '../views/Chat.vue'

/**
 * 路由配置
 */
const router = createRouter({
  /**
   * 使用 HTML5 History 模式
   * URL 格式：/chat 而非 /#/chat
   * 需要服务器配置支持
   */
  history: createWebHistory(),

  /**
   * 路由规则列表
   */
  routes: [
    {
      /**
       * 根路径
       * 默认显示聊天页面
       */
      path: '/',
      name: 'chat',
      component: Chat
    }
  ]
})

/**
 * 导航守卫示例
 *
 * 可以添加以下功能：
 * - 页面标题设置
 * - 登录状态检查
 * - 权限验证
 * - 滚动位置恢复
 */

/**
 * 全局前置守卫
 * 每次导航前触发
 */
router.beforeEach((to, from, next) => {
  // 可以在这里添加权限检查、登录状态验证等
  // 示例：
  // if (!isAuthenticated && to.meta.requiresAuth) {
  //   next('/login')
  // } else {
  //   next()
  // }

  next()
})

/**
 * 全局后置钩子
 * 每次导航后触发
 */
router.afterEach((to, from) => {
  // 可以在这里设置页面标题、发送页面访问统计等
  // 示例：
  // document.title = to.meta.title || 'AI Chat'
  // trackPageView(to.path)
})

/**
 * 错误处理
 * 捕获路由导航错误
 */
router.onError((error) => {
  console.error('[Router] Navigation error:', error)
  // 可以在这里添加错误上报或用户提示
})

export default router
