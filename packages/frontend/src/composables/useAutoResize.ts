import { ref, onMounted, onUnmounted } from 'vue'

interface UseAutoResizeOptions {
  maxHeight?: number
  minHeight?: number
}

export function useAutoResize({ maxHeight = 200, minHeight = 0 }: UseAutoResizeOptions = {}) {
  const textareaRef = ref<HTMLTextAreaElement | null>(null)
  let frame: number | undefined

  function resize() {
    const element = textareaRef.value
    if (!element || frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined
      element.style.height = 'auto'
      const style = window.getComputedStyle(element)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const minimum = Math.max(
        minHeight,
        Number.isNaN(lineHeight) ? Number.parseFloat(style.fontSize) * 1.5 : lineHeight
      )
      const height = Math.max(minimum, element.scrollHeight)
      element.style.height = `${maxHeight > 0 ? Math.min(height, maxHeight) : height}px`
      element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
    })
  }

  function cancelResize() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  function reset() {
    cancelResize()
    const element = textareaRef.value
    if (!element) return
    element.style.height = 'auto'
    element.style.overflowY = 'hidden'
  }

  onMounted(resize)
  onUnmounted(cancelResize)
  return { textareaRef, resize, reset }
}
