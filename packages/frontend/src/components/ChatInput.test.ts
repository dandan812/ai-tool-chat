import { readFileSync } from 'node:fs'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from './ChatInput.vue'
import { MAX_IMAGES } from '../config'
import { uploadChunkedFile } from '../utils/chunk'
import { resolveDraftImage, saveDraftImage } from '../utils/draftImageStore'
import type { UploadedFileRef, UploadProgress } from '../types/task'

vi.mock('element-plus/es/components/tooltip/style/css', () => ({}))
vi.mock('../utils/chunk', () => ({ uploadChunkedFile: vi.fn() }))
vi.mock('../utils/draftImageStore', () => ({
  clearDraftImages: vi.fn(async () => {}),
  loadDraftImages: vi.fn(async () => []),
  revokeDraftPreviews: vi.fn(),
  syncDraftImageRefs: vi.fn(),
  removeDraftImage: vi.fn(async () => {}),
  resolveDraftImage: vi.fn(),
  saveDraftImage: vi.fn()
}))

let app: App | undefined
let tokenStyle: HTMLStyleElement
const tokens = readFileSync('src/styles/tokens.css', 'utf8')
const uploaded: UploadedFileRef = {
  fileId: 'file-one',
  fileHash: 'hash-one',
  fileName: 'notes.txt',
  mimeType: 'text/plain',
  size: 24,
  source: 'uploaded'
}
const progress: UploadProgress = {
  fileId: 'file-one',
  fileName: 'notes.txt',
  percentage: 50,
  uploadedChunks: 1,
  totalChunks: 2,
  speed: 12,
  estimatedTime: 1
}

beforeEach(() => {
  tokenStyle = document.createElement('style')
  tokenStyle.textContent = tokens
  document.head.append(tokenStyle)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.mocked(uploadChunkedFile).mockResolvedValue(uploaded)
  vi.mocked(saveDraftImage).mockImplementation(async (file) => ({
    id: file.name,
    draftKey: file.name,
    previewUrl: 'data:image/png;base64,synthetic',
    mimeType: file.type,
    description: file.name
  }))
  vi.mocked(resolveDraftImage).mockImplementation(async (image) => ({
    id: image.id,
    mimeType: image.mimeType,
    base64: 'synthetic',
    description: image.description
  }))
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  tokenStyle.remove()
  vi.unstubAllGlobals()
})

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}
async function mount() {
  const props = ref({ sessionId: 'first', loading: false })
  const send = vi.fn()
  const stop = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    setup: () => () =>
      h(ChatInput, {
        ...props.value,
        key: props.value.sessionId,
        onSend: send,
        onStop: stop
      })
  })
  app.mount(root)
  await settle()
  return { root, props, send, stop }
}
function button(root: HTMLElement, label: string) {
  const element = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(element, label).not.toBeNull()
  return element!
}
function select(root: HTMLElement, index: number, files: File[]) {
  const input = root.querySelectorAll<HTMLInputElement>('input[type="file"]')[index]!
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
function enter(root: HTMLElement, value: string) {
  const input = root.querySelector('textarea')!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('compact chat attachments', () => {
  it('enables research only for uploaded files and clears it when an image is added', async () => {
    const { root, send } = await mount()
    expect(root.querySelector('.composer-research')).toBeNull()
    select(root, 1, [new File(['notes'], 'notes.txt', { type: 'text/plain' })])
    await settle()
    const toggle = root.querySelector<HTMLInputElement>('.composer-research input')!
    expect(toggle.checked).toBe(false)
    toggle.click()
    enter(root, '检索交付日期')
    await settle()
    button(root, '发送消息').click()
    await settle()
    expect(send).toHaveBeenCalledWith('检索交付日期', [], [uploaded], true)
    select(root, 1, [new File(['notes'], 'notes.txt', { type: 'text/plain' })])
    await settle()
    root.querySelector<HTMLInputElement>('.composer-research input')!.click()
    select(root, 0, [new File(['image'], 'figure.png', { type: 'image/png' })])
    await settle()
    expect(root.querySelector('.composer-research')).toBeNull()
    button(root, '发送消息').click()
    await settle()
    expect(send.mock.calls[send.mock.calls.length - 1]).toHaveLength(3)
  })
  it('supports menu keyboard navigation, escape focus restoration and outside dismissal', async () => {
    const { root, props } = await mount()
    const menu = root.querySelector<HTMLDetailsElement>('.attachment-menu')!
    const trigger = menu.querySelector('summary')!
    trigger.focus()
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(menu.open).toBe(true)
    expect(document.activeElement).toBe(button(root, '添加图片'))
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    )
    expect(document.activeElement).toBe(button(root, '添加文件'))
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    menu.open = true
    root.querySelector('textarea')!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(menu.open).toBe(false)
    menu.open = true
    props.value.loading = true
    await settle()
    expect(menu.open).toBe(false)
    trigger.click()
    expect(menu.open).toBe(false)
  })

  it('opens the original pickers directly and leaves no empty upload trays', async () => {
    const { root } = await mount()
    expect(root.querySelector('.upload-zone')).toBeNull()
    expect(root.querySelector<HTMLElement>('.composer-attachments')!.style.display).toBe('none')
    const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]')
    const imagePicker = vi.spyOn(inputs[0]!, 'click').mockImplementation(() => {})
    const filePicker = vi.spyOn(inputs[1]!, 'click').mockImplementation(() => {})
    button(root, '添加图片').click()
    button(root, '添加文件').click()
    expect(imagePicker).toHaveBeenCalledOnce()
    expect(filePicker).toHaveBeenCalledOnce()
    expect(root.querySelector<HTMLElement>('.composer-attachments')!.style.display).toBe('none')
  })

  it('blocks sending from hashing through the whole batch, then sends real attachment refs once', async () => {
    const first = deferred<UploadedFileRef>()
    const second = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { root, send } = await mount()
    enter(root, '分析文件')
    select(root, 1, [
      new File(['one'], 'notes.txt', { type: 'text/plain' }),
      new File(['two'], 'second.txt', { type: 'text/plain' })
    ])
    await settle()
    expect(button(root, '发送消息').disabled).toBe(true)
    expect(button(root, '添加文件').disabled).toBe(true)
    expect(root.querySelector('[role="status"]')?.textContent).toContain('文件上传中')
    uploadChunkedFileProgress(0, progress)
    await settle()
    expect(root.querySelector('progress')?.value).toBe(50)
    first.resolve(uploaded)
    await settle()
    expect(button(root, '发送消息').disabled).toBe(true)
    expect(root.querySelector('.file-name')?.textContent).toBe('notes.txt')
    const other = { ...uploaded, fileId: 'file-two', fileName: 'second.txt' }
    second.resolve(other)
    await settle()
    expect(root.querySelector('progress')).toBeNull()
    expect(button(root, '发送消息').disabled).toBe(false)
    button(root, '发送消息').click()
    await settle()
    expect(send).toHaveBeenCalledExactlyOnceWith('分析文件', [], [uploaded, other])
    expect(root.querySelector('.file-chip')).toBeNull()
    expect(root.querySelector<HTMLElement>('.composer-attachments')!.style.display).toBe('none')
  })

  it('shows upload failure inline and permits a retry without leaving stale progress', async () => {
    const operation = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile).mockReturnValueOnce(operation.promise)
    const { root } = await mount()
    select(root, 1, [new File(['one'], 'notes.txt', { type: 'text/plain' })])
    uploadChunkedFileProgress(0, progress)
    await settle()
    operation.reject(new Error('连接中断，请重试'))
    await settle()
    expect(root.querySelector('.status-banner.is-error')?.textContent).toContain('连接中断')
    expect(root.querySelector('progress')).toBeNull()
    expect(button(root, '添加文件').disabled).toBe(false)
    select(root, 1, [new File(['one'], 'notes.txt', { type: 'text/plain' })])
    await settle()
    expect(root.querySelector('.status-banner.is-error')).toBeNull()
    expect(button(root, '发送消息').disabled).toBe(false)
  })

  it('keeps previews compact, enforces the image limit, and removes the last attachment', async () => {
    const { root } = await mount()
    select(
      root,
      0,
      Array.from(
        { length: MAX_IMAGES + 1 },
        (_, index) => new File(['image'], `${index}.png`, { type: 'image/png' })
      )
    )
    await settle()
    expect(saveDraftImage).toHaveBeenCalledTimes(MAX_IMAGES)
    expect(root.querySelectorAll('.image-card img')).toHaveLength(MAX_IMAGES)
    expect(root.querySelector('.status-banner.is-error')?.textContent).toContain(
      `最多选择 ${MAX_IMAGES} 张图片`
    )
    expect(button(root, '添加图片').disabled).toBe(true)
    for (let index = 0; index < MAX_IMAGES; index++) {
      button(root, '移除图片').click()
      await settle()
    }
    expect(button(root, '添加图片').disabled).toBe(false)
    expect(root.querySelector<HTMLElement>('.composer-attachments')!.style.display).toBe('none')
    expect(button(root, '发送消息').disabled).toBe(true)
  })

  it('routes a mixed drop to image preparation and the original chunk uploader', async () => {
    const { root } = await mount()
    const image = new File(['image'], 'figure.png', { type: 'image/png' })
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [image, file] } })
    root.querySelector('.composer-panel')!.dispatchEvent(drop)
    await settle()
    expect(drop.defaultPrevented).toBe(true)
    expect(saveDraftImage).toHaveBeenCalledExactlyOnceWith(image)
    expect(uploadChunkedFile).toHaveBeenCalledWith(file, expect.any(Object))
    expect(root.querySelectorAll('.image-card, .file-chip')).toHaveLength(2)
    button(root, '移除附件').click()
    await settle()
    expect(root.querySelector('.file-chip')).toBeNull()
    expect(root.querySelector('.image-card')).not.toBeNull()
  })

  it('disables editing and attachments while generating and preserves the stop action', async () => {
    const { root, props, stop } = await mount()
    select(root, 0, [new File(['image'], 'figure.png', { type: 'image/png' })])
    await settle()
    props.value.loading = true
    await settle()
    expect(root.querySelector('textarea')?.disabled).toBe(true)
    for (const label of ['添加图片', '添加文件', '移除图片']) {
      expect(button(root, label).disabled).toBe(true)
    }
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] }
    })
    root.querySelector('.composer-panel')!.dispatchEvent(drop)
    expect(uploadChunkedFile).not.toHaveBeenCalled()
    button(root, '停止生成').click()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('does not leak late uploads or start remaining batch files after switching sessions', async () => {
    const operation = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile).mockReturnValueOnce(operation.promise)
    const { root, props } = await mount()
    select(root, 1, [
      new File(['one'], 'notes.txt', { type: 'text/plain' }),
      new File(['two'], 'second.txt', { type: 'text/plain' })
    ])
    await settle()
    props.value.sessionId = 'second'
    await settle()
    uploadChunkedFileProgress(0, progress)
    operation.resolve(uploaded)
    await settle()
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(root.querySelector('.file-chip, progress, .status-banner')).toBeNull()
    expect(button(root, '添加文件').disabled).toBe(false)
    enter(root, '新会话')
    await settle()
    expect(button(root, '发送消息').disabled).toBe(false)
  })

  it('reports unsupported files without uploading or opening empty trays', async () => {
    const { root } = await mount()
    select(root, 1, [new File(['binary'], 'program.exe', { type: 'application/octet-stream' })])
    await settle()
    expect(uploadChunkedFile).not.toHaveBeenCalled()
    expect(root.querySelector('.status-banner.is-error')?.textContent).toContain('不支持的文件类型')
    expect(root.querySelector('.upload-zone')).toBeNull()
    expect(root.querySelector<HTMLElement>('.composer-attachments')!.style.display).toBe('none')
    select(root, 0, [new File(['image'], 'figure.png', { type: 'image/png' })])
    await settle()
    expect(root.querySelector('.status-banner.is-error')).toBeNull()
    expect(root.querySelector('.image-card img')?.getAttribute('alt')).toBe('figure.png')
  })
})

function uploadChunkedFileProgress(call: number, value: UploadProgress) {
  vi.mocked(uploadChunkedFile).mock.calls[call]![1]!.onProgress!(value)
}
