import { ref, nextTick } from 'vue'

export function useScroll() {
  // 获取消息容器的 DOM 引用，用于控制滚动
  const container = ref<HTMLElement | null>(null)
  let scrollingScheduled = false

  // 自动滚动到底部的函数
  const scrollToBottom = async () => {
    if (scrollingScheduled) return
    scrollingScheduled = true
    requestAnimationFrame(async () => {
      await nextTick()
      const el = container.value
      if (el) {
        el.scrollTop = el.scrollHeight
      }
      scrollingScheduled = false
    })
  }

  // 检查是否需要自动滚动
  const shouldAutoScroll = (): boolean => {
    if (!container.value) return true
    const { scrollTop, scrollHeight, clientHeight } = container.value
    return scrollHeight - scrollTop - clientHeight < 100
  }

  return {
    container,
    scrollToBottom,
    shouldAutoScroll
  }
}
