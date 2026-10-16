import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScroll } from './useScroll'

let app: App | undefined
let frames: Map<number, FrameRequestCallback>
let sequence: number

beforeEach(() => {
  vi.useFakeTimers()
  frames = new Map()
  sequence = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function frame() {
  const callbacks = [...frames.values()]
  frames.clear()
  callbacks.forEach((callback) => callback(0))
}

async function mount() {
  let scroll!: ReturnType<typeof useScroll>
  app = createApp({
    setup() {
      scroll = useScroll()
      return () => h('div')
    }
  })
  const root = document.createElement('div')
  document.body.append(root)
  app.mount(root)
  const element = document.createElement('div')
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 1200 },
    clientHeight: { configurable: true, value: 400 }
  })
  element.scrollTo = vi.fn()
  scroll.container.value = element
  await nextTick()
  return { scroll, element }
}

describe('chat scrolling', () => {
  it('coalesces a burst into one frame and scrolls to the latest content height', async () => {
    const { scroll, element } = await mount()
    const operations = Array.from({ length: 50 }, () => scroll.scrollToBottom(true))
    Object.defineProperty(element, 'scrollHeight', { value: 2000 })
    expect(frames.size).toBe(1)
    frame()
    await Promise.all(operations)
    expect(element.scrollTop).toBe(1600)
    expect(scroll.isAtBottom.value).toBe(true)
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not poll layout every frame during a manual smooth scroll', async () => {
    const { scroll, element } = await mount()
    const operation = scroll.scrollToBottom()
    frame()
    expect(element.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'smooth' })
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(500)
    await operation
    expect(scroll.isScrolling.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the previous smooth-scroll timer when streaming takes over', async () => {
    const { scroll, element } = await mount()
    const manual = scroll.scrollToBottom()
    frame()
    const streaming = scroll.scrollToBottom(true)
    expect(vi.getTimerCount()).toBe(0)
    frame()
    await Promise.all([manual, streaming])
    expect(element.scrollTop).toBe(800)
    expect(frames.size).toBe(0)
  })

  it('respects scrolling up and detaches listeners when the container changes', async () => {
    const { scroll, element } = await mount()
    element.scrollTop = 800
    element.dispatchEvent(new Event('scroll'))
    expect(scroll.shouldAutoScroll()).toBe(true)
    element.scrollTop = 100
    element.dispatchEvent(new Event('scroll'))
    expect(scroll.shouldAutoScroll()).toBe(false)
    const replacement = document.createElement('div')
    scroll.container.value = replacement
    await nextTick()
    expect(scroll.shouldAutoScroll()).toBe(true)
    element.dispatchEvent(new Event('scroll'))
    expect(scroll.shouldAutoScroll()).toBe(true)
  })

  it('settles queued requests and removes scheduled work on unmount', async () => {
    const { scroll } = await mount()
    const operation = scroll.scrollToBottom()
    app!.unmount()
    app = undefined
    await operation
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('honors reduced motion for manual scrolling', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { scroll, element } = await mount()
    const operation = scroll.scrollToBottom()
    frame()
    await operation
    expect(element.scrollTop).toBe(800)
    expect(element.scrollTo).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
