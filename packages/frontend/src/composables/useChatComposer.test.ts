import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatComposer } from './useChatComposer'
import { removeDraftImage, resolveDraftImage, saveDraftImage } from '../utils/draftImageStore'
import type { DraftImage, ImageData } from '../types/task'

vi.mock('../utils/draftImageStore', () => ({
  clearDraftImages: vi.fn(async () => {}),
  loadDraftImages: vi.fn(async () => []),
  revokeDraftPreviews: vi.fn(),
  syncDraftImageRefs: vi.fn(),
  removeDraftImage: vi.fn(),
  resolveDraftImage: vi.fn(),
  saveDraftImage: vi.fn()
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

async function mountComposer() {
  let composer!: ReturnType<typeof useChatComposer>
  const send = vi.fn()
  app = createApp({
    setup() {
      composer = useChatComposer({ loading: ref(false), sessionId: ref('test'), onSend: send })
      return () => null
    }
  })
  app.mount(document.createElement('div'))
  await nextTick()
  return { composer, send }
}

describe('composer keyboard input', () => {
  it('blocks sends during image preparation and discards results after leaving the composer', async () => {
    const { composer } = await mountComposer()
    let finish!: (image: DraftImage) => void
    vi.mocked(saveDraftImage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    composer.input.value = 'question'
    const operation = composer.addImage(new File(['synthetic'], 'test.png', { type: 'image/png' }))
    expect(composer.canSend.value).toBe(false)
    app!.unmount()
    app = undefined
    const draft = {
      id: 'late',
      draftKey: 'late-key',
      previewUrl: 'blob:late',
      mimeType: 'image/png'
    }
    finish(draft)
    await operation
    expect(composer.images.value).toEqual([])
    expect(removeDraftImage).toHaveBeenCalledWith('late-key', 'blob:late')
  })

  it('resolves attachments once when send is pressed twice before async preparation finishes', async () => {
    const { composer, send } = await mountComposer()
    let finish!: (image: ImageData) => void
    vi.mocked(resolveDraftImage).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    composer.images.value = [
      { id: 'one', draftKey: 'key', previewUrl: 'blob:one', mimeType: 'image/png' }
    ]
    composer.input.value = 'question'
    const first = composer.sendMessage()
    const second = composer.sendMessage()
    finish({ id: 'one', base64: 'synthetic', mimeType: 'image/png' })
    await Promise.all([first, second])
    expect(send).toHaveBeenCalledTimes(1)
    expect(resolveDraftImage).toHaveBeenCalledTimes(1)
  })

  it('does not send during IME composition or Shift+Enter, but sends ordinary Enter', async () => {
    let composer: ReturnType<typeof useChatComposer>
    const send = vi.fn()
    app = createApp({
      setup() {
        composer = useChatComposer({ loading: ref(false), sessionId: ref('test'), onSend: send })
        return () => null
      }
    })
    app.mount(document.createElement('div'))
    await nextTick()
    composer!.input.value = '问题'
    for (const options of [{ isComposing: true }, { shiftKey: true }, { keyCode: 229 }]) {
      composer!.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', ...options }))
    }
    await nextTick()
    expect(send).not.toHaveBeenCalled()
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    composer!.handleKeydown(event)
    await nextTick()
    expect(event.defaultPrevented).toBe(true)
    expect(send).toHaveBeenCalledWith('问题', [], [])
  })
})
