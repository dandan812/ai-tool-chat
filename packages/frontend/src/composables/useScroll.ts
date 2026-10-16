import { ref, watch, onUnmounted, readonly } from 'vue'

/**
 * 滚动管理 Composable - 优化版
 * 提供自动滚动、智能判断、滚动位置记忆等功能
 */

interface UseScrollOptions {
  /** 自动滚动阈值（距离底部像素） */
  threshold?: number
  /** 滚动动画行为 */
  behavior?: ScrollBehavior
  /** 是否监听滚动 */
  watchScroll?: boolean
}

interface ScrollInfo {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  distanceToBottom: number
  scrollProgress: number
  isAtTop: boolean
  isAtBottom: boolean
}

const DEFAULT_OPTIONS: Required<UseScrollOptions> = {
  threshold: 100,
  behavior: 'smooth',
  watchScroll: true
}

/**
 * 创建滚动管理器
 */
export function useScroll(options: UseScrollOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const container = ref<HTMLElement | null>(null)
  const isScrolling = ref(false)
  const isAtBottom = ref(true)
  const scrollProgress = ref(0)

  let scrollTimeout: ReturnType<typeof setTimeout> | null = null
  let rafId: number | null = null
  let completionTimer: ReturnType<typeof setTimeout> | null = null
  let finishScroll: (() => void) | null = null

  /**
   * 获取滚动信息
   */
  function getScrollInfo(): ScrollInfo | null {
    const el = container.value
    if (!el) return null

    const { scrollTop, scrollHeight, clientHeight } = el
    const distanceToBottom = scrollHeight - scrollTop - clientHeight
    const progress = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0

    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      distanceToBottom,
      scrollProgress: progress,
      isAtTop: scrollTop <= 0,
      isAtBottom: distanceToBottom <= opts.threshold
    }
  }

  /**
   * 更新滚动状态
   */
  function updateScrollState(): void {
    const info = getScrollInfo()
    if (!info) return

    isAtBottom.value = info.isAtBottom
    scrollProgress.value = info.scrollProgress
  }

  /**
   * 滚动到底部
   */
  function scrollToBottom(immediate = false): Promise<void> {
    // Replace stale targets and keep only one scheduled frame and completion timer.
    stopScroll()
    return new Promise((resolve) => {
      if (!container.value) {
        resolve()
        return
      }

      isScrolling.value = true
      finishScroll = resolve
      rafId = requestAnimationFrame(() => {
        rafId = null
        const el = container.value
        if (!el) {
          stopScroll()
          return
        }

        const targetScroll = el.scrollHeight - el.clientHeight

        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        if (immediate || opts.behavior === 'auto' || reducedMotion) {
          el.scrollTop = targetScroll
          updateScrollState()
          stopScroll()
        } else {
          el.scrollTo({
            top: targetScroll,
            behavior: opts.behavior
          })

          completionTimer = setTimeout(() => {
            updateScrollState()
            stopScroll()
          }, 500)
        }
      })
    })
  }

  /**
   * 滚动到顶部
   */
  function scrollToTop(immediate = false): void {
    stopScroll()
    if (!container.value) return
    container.value.scrollTo({
      top: 0,
      behavior: immediate ? 'auto' : opts.behavior
    })
    updateScrollState()
  }

  /**
   * 滚动到指定元素
   */
  function scrollToElement(element: HTMLElement, offset = 0): void {
    if (!container.value) return

    const containerRect = container.value.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const relativeTop = elementRect.top - containerRect.top + container.value.scrollTop - offset

    container.value.scrollTo({
      top: relativeTop,
      behavior: opts.behavior
    })
  }

  /**
   * 检查是否应该自动滚动
   */
  function shouldAutoScroll(): boolean {
    return isAtBottom.value
  }

  /**
   * 处理滚动事件（带防抖）
   */
  function handleScroll(): void {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout)
    }

    updateScrollState()

    // 滚动结束后更新状态
    scrollTimeout = setTimeout(() => {
      updateScrollState()
    }, 150)
  }

  /**
   * 停止滚动
   */
  function stopScroll(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (completionTimer !== null) clearTimeout(completionTimer)
    completionTimer = null
    isScrolling.value = false
    finishScroll?.()
    finishScroll = null
  }

  // ==================== 生命周期 ====================

  watch(
    container,
    (element, previous) => {
      previous?.removeEventListener('scroll', handleScroll)
      stopScroll()
      if (opts.watchScroll && element) {
        element.addEventListener('scroll', handleScroll, { passive: true })
        updateScrollState()
      }
    },
    { flush: 'post' }
  )

  onUnmounted(() => {
    stopScroll()
    if (scrollTimeout) {
      clearTimeout(scrollTimeout)
    }
    if (container.value) {
      container.value.removeEventListener('scroll', handleScroll)
    }
  })

  return {
    // 引用
    container,

    // 状态
    isScrolling: readonly(isScrolling),
    isAtBottom: readonly(isAtBottom),
    scrollProgress: readonly(scrollProgress),

    // 方法
    scrollToBottom,
    scrollToTop,
    scrollToElement,
    shouldAutoScroll,
    getScrollInfo,
    stopScroll
  }
}
