import { createApp, h } from 'vue'
import { expect, it, vi } from 'vitest'
import { useAutoResize } from './useAutoResize'

it('coalesces height updates, respects limits and cancels pending work on reset and unmount', () => {
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  let resize!: ReturnType<typeof useAutoResize>
  const app = createApp({
    setup() {
      resize = useAutoResize({ minHeight: 36, maxHeight: 160 })
      return () => h('textarea', { ref: resize.textareaRef, style: 'font-size: 16px' })
    }
  })
  const host = document.createElement('div')
  document.body.append(host)
  try {
    app.mount(host)
    const element = resize.textareaRef.value!
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 250 })
    resize.resize()
    resize.resize()
    expect(frames.size).toBe(1)
    const flush = () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(0))
    }
    flush()
    expect(element.style.height).toBe('160px')
    expect(element.style.overflowY).toBe('auto')
    Object.defineProperty(element, 'scrollHeight', { value: 10 })
    resize.resize()
    flush()
    expect(element.style.height).toBe('36px')
    expect(element.style.overflowY).toBe('hidden')
    resize.resize()
    resize.reset()
    expect(frames.size).toBe(0)
    expect(element.style.height).toBe('auto')
    resize.resize()
  } finally {
    app.unmount()
    host.remove()
    expect(frames.size).toBe(0)
    vi.unstubAllGlobals()
  }
})
