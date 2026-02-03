import { ref, onMounted, onUnmounted, readonly } from 'vue'

/**
 * 自动调整大小 Composable - 优化版
 * 支持 textarea 高度自适应、ResizeObserver、最大/最小高度限制
 */

interface UseAutoResizeOptions {
  /** 最大高度（px） */
  maxHeight?: number
  /** 最小高度（px） */
  minHeight?: number
  /** 行高（px），用于计算 */
  lineHeight?: number
  /** 是否启用 ResizeObserver */
  observeResize?: boolean
  /** 调整前的钩子 */
  onBeforeResize?: (el: HTMLTextAreaElement) => void
  /** 调整后的钩子 */
  onAfterResize?: (el: HTMLTextAreaElement, height: number) => void
}

const DEFAULT_OPTIONS: Required<Pick<UseAutoResizeOptions, 'maxHeight' | 'minHeight' | 'observeResize'>> & {
  lineHeight: number | undefined
} = {
  maxHeight: 200,
  minHeight: 0,
  lineHeight: undefined,
  observeResize: false
}

/**
 * 创建自动调整大小管理器
 */
export function useAutoResize(options: UseAutoResizeOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  
  const textareaRef = ref<HTMLTextAreaElement | null>(null)
  const currentHeight = ref(0)
  const isResizing = ref(false)
  
  let resizeObserver: ResizeObserver | null = null
  let rafId: number | null = null

  /**
   * 计算行高
   */
  function getLineHeight(el: HTMLTextAreaElement): number {
    if (opts.lineHeight) return opts.lineHeight
    
    const style = window.getComputedStyle(el)
    const lineHeight = parseFloat(style.lineHeight)
    
    return isNaN(lineHeight) ? parseFloat(style.fontSize) * 1.5 : lineHeight
  }

  /**
   * 调整高度（核心函数）
   */
  function resize(): void {
    const el = textareaRef.value
    if (!el || isResizing.value) return

    isResizing.value = true
    opts.onBeforeResize?.(el)

    // 使用 requestAnimationFrame 优化性能
    rafId = requestAnimationFrame(() => {
      if (!el) {
        isResizing.value = false
        return
      }

      // 重置高度以获取真实 scrollHeight
      el.style.height = 'auto'
      
      // 计算新高度
      const scrollHeight = el.scrollHeight
      const lineHeight = getLineHeight(el)
      const minHeight = Math.max(opts.minHeight, lineHeight)
      const maxHeight = opts.maxHeight
      
      // 应用边界限制
      let newHeight = Math.max(minHeight, scrollHeight)
      if (maxHeight > 0) {
        newHeight = Math.min(newHeight, maxHeight)
      }

      // 设置高度
      el.style.height = `${newHeight}px`
      el.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden'
      
      currentHeight.value = newHeight
      isResizing.value = false
      
      opts.onAfterResize?.(el, newHeight)
    })
  }

  /**
   * 重置高度
   */
  function reset(): void {
    const el = textareaRef.value
    if (!el) return

    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    el.style.height = 'auto'
    el.style.overflowY = 'hidden'
    currentHeight.value = 0
    isResizing.value = false
  }

  /**
   * 设置特定高度
   */
  function setHeight(height: number): void {
    const el = textareaRef.value
    if (!el) return

    const validHeight = Math.max(opts.minHeight, Math.min(height, opts.maxHeight))
    el.style.height = `${validHeight}px`
    currentHeight.value = validHeight
  }

  /**
   * 插入换行并调整
   */
  function insertNewline(): void {
    const el = textareaRef.value
    if (!el) return

    const start = el.selectionStart
    const end = el.selectionEnd
    const value = el.value

    el.value = value.substring(0, start) + '\n' + value.substring(end)
    el.selectionStart = el.selectionEnd = start + 1
    
    resize()
  }

  // ==================== 生命周期 ====================

  onMounted(() => {
    if (!textareaRef.value) return

    // 初始调整
    resize()

    // 可选：监听元素大小变化
    if (opts.observeResize && 'ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => {
        resize()
      })
      resizeObserver.observe(textareaRef.value)
    }
  })

  onUnmounted(() => {
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
    }
  })

  return {
    textareaRef,
    currentHeight: readonly(currentHeight),
    isResizing: readonly(isResizing),
    resize,
    reset,
    setHeight,
    insertNewline
  }
}

/**
 * 创建带防抖的自动调整
 */
export function useDebouncedAutoResize(
  options: UseAutoResizeOptions & { debounceMs?: number } = {}
) {
  const { debounceMs = 50, ...resizeOptions } = options
  const { textareaRef, resize: rawResize, reset, ...rest } = useAutoResize(resizeOptions)
  
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function resize(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      rawResize()
    }, debounceMs)
  }

  function flush(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    rawResize()
  }

  onUnmounted(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
  })

  return {
    textareaRef,
    resize,
    flush,
    reset,
    ...rest
  }
}

