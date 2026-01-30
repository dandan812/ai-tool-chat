import { ref, nextTick } from 'vue'

/**
 * 滚动管理 Composable
 * 提供自动滚动到底部和智能滚动判断功能
 */

/** 距离底部的阈值（像素），小于此值时触发自动滚动 */
const AUTO_SCROLL_THRESHOLD = 100

export function useScroll() {
  /** 消息容器引用 - 通过模板 ref 绑定 */
  const container = ref<HTMLElement | null>(null)
  let isScrolling = false

  /**
   * 滚动到底部
   * 使用 requestAnimationFrame 和 nextTick 确保 DOM 更新后执行
   */
  async function scrollToBottom(): Promise<void> {
    if (isScrolling || !container.value) return

    isScrolling = true

    requestAnimationFrame(async () => {
      await nextTick()

      const el = container.value
      if (el) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth'
        })
      }

      isScrolling = false
    })
  }

  /**
   * 立即滚动到底部（无动画）
   * 适用于初始化或需要即时响应的场景
   */
  function scrollToBottomImmediate(): void {
    const el = container.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }

  /**
   * 检查是否应该自动滚动
   * 当用户向上滚动查看历史消息时，不自动滚动避免打断阅读
   */
  function shouldAutoScroll(): boolean {
    const el = container.value
    if (!el) return true

    const { scrollTop, scrollHeight, clientHeight } = el
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    return distanceToBottom < AUTO_SCROLL_THRESHOLD
  }

  /**
   * 获取当前滚动位置信息
   */
  function getScrollInfo() {
    const el = container.value
    if (!el) return null

    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      distanceToBottom: el.scrollHeight - el.scrollTop - el.clientHeight
    }
  }

  return {
    container,
    scrollToBottom,
    scrollToBottomImmediate,
    shouldAutoScroll,
    getScrollInfo
  }
}
