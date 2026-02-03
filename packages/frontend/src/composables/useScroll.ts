import { ref, onMounted, onUnmounted, readonly } from 'vue'

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

  /**
   * 获取滚动信息
   */
  function getScrollInfo(): ScrollInfo | null {
    const el = container.value
    if (!el) return null

    const { scrollTop, scrollHeight, clientHeight } = el
    const distanceToBottom = scrollHeight - scrollTop - clientHeight
    const progress = scrollHeight > clientHeight 
      ? scrollTop / (scrollHeight - clientHeight)
      : 0

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
    return new Promise((resolve) => {
      if (isScrolling.value || !container.value) {
        resolve()
        return
      }

      isScrolling.value = true
      
      const doScroll = () => {
        const el = container.value
        if (!el) {
          isScrolling.value = false
          resolve()
          return
        }

        const targetScroll = el.scrollHeight - el.clientHeight
        
        if (immediate) {
          el.scrollTop = targetScroll
          updateScrollState()
          isScrolling.value = false
          resolve()
        } else {
          el.scrollTo({
            top: targetScroll,
            behavior: opts.behavior
          })

          // 等待滚动完成
          const checkScroll = () => {
            const info = getScrollInfo()
            if (info && info.distanceToBottom <= 1) {
              updateScrollState()
              isScrolling.value = false
              resolve()
            } else {
              rafId = requestAnimationFrame(checkScroll)
            }
          }
          
          // 设置超时防止卡住
          setTimeout(() => {
            if (isScrolling.value) {
              if (rafId) cancelAnimationFrame(rafId)
              isScrolling.value = false
              updateScrollState()
              resolve()
            }
          }, 500)
          
          rafId = requestAnimationFrame(checkScroll)
        }
      }

      requestAnimationFrame(doScroll)
    })
  }

  /**
   * 滚动到顶部
   */
  function scrollToTop(): void {
    if (!container.value) return
    container.value.scrollTo({ top: 0, behavior: opts.behavior })
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
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    isScrolling.value = false
  }

  // ==================== 生命周期 ====================

  onMounted(() => {
    if (opts.watchScroll && container.value) {
      container.value.addEventListener('scroll', handleScroll, { passive: true })
      updateScrollState()
    }
  })

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

/**
 * 创建虚拟滚动优化（用于超长列表）
 */
export function useVirtualScroll(itemHeight: number, overscan = 5) {
  const container = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewportHeight = ref(0)

  function getVisibleRange(totalItems: number) {
    const start = Math.floor(scrollTop.value / itemHeight)
    const visibleCount = Math.ceil(viewportHeight.value / itemHeight)
    
    const startIndex = Math.max(0, start - overscan)
    const endIndex = Math.min(totalItems, start + visibleCount + overscan)
    
    return {
      startIndex,
      endIndex,
      offsetY: startIndex * itemHeight,
      visibleCount: endIndex - startIndex
    }
  }

  function onScroll() {
    if (!container.value) return
    scrollTop.value = container.value.scrollTop
    viewportHeight.value = container.value.clientHeight
  }

  onMounted(() => {
    if (container.value) {
      viewportHeight.value = container.value.clientHeight
      container.value.addEventListener('scroll', onScroll, { passive: true })
    }
  })

  onUnmounted(() => {
    container.value?.removeEventListener('scroll', onScroll)
  })

  return {
    container,
    scrollTop,
    getVisibleRange
  }
}

