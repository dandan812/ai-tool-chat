import { readFileSync } from 'node:fs'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Chat from './Chat.vue'
import { useChatStore } from '../stores/chat'
import { uploadChunkedFile } from '../utils/chunk'

vi.mock('../stores/chat', () => ({ useChatStore: vi.fn() }))
vi.mock('../utils/chunk', () => ({ uploadChunkedFile: vi.fn() }))
vi.mock('../utils/draftImageStore', () => ({
  loadDraftImages: vi.fn(async () => []),
  revokeDraftPreviews: vi.fn(),
  syncDraftImageRefs: vi.fn(),
  clearDraftImages: vi.fn(async () => [])
}))
vi.mock('../components/ChatMessages.vue', () => ({ default: { render: () => h('section') } }))
vi.mock('../components/WorkspacePanel.vue', () => ({
  default: {
    props: ['view'],
    emits: ['openTask', 'updateOpen'],
    setup:
      (props: { view: string }, { emit }: { emit: (event: string, value: unknown) => void }) =>
      () =>
        h('section', { 'data-resource-view': props.view }, [
          h('button', { onClick: () => emit('openTask', 'task-one') }, '恢复任务'),
          h('button', { onClick: () => emit('updateOpen', false) }, '关闭面板')
        ])
  }
}))
vi.mock('element-plus/es/components/drawer/style/css', () => ({}))
vi.mock('element-plus/es/components/button/style/css', () => ({}))
vi.mock('element-plus/es/components/dialog/style/css', () => ({}))
vi.mock('element-plus/es/components/input/style/css', () => ({}))
vi.mock('element-plus/es/components/menu/style/css', () => ({}))
vi.mock('element-plus/es/components/menu-item/style/css', () => ({}))
vi.mock('element-plus/es/components/tooltip/style/css', () => ({}))

let app: App | undefined
let tokenStyle: HTMLStyleElement
let store: ReturnType<typeof makeStore>
function makeStore() {
  return reactive({
    currentSessionId: 'session-one',
    sessions: [{ id: 'session-one', title: '新对话', updatedAt: Date.now() }],
    messages: [] as { role: string; content: string }[],
    isLoading: false,
    storageError: null,
    restoreActiveTask: vi.fn(async () => {}),
    restoreTask: vi.fn(async () => {}),
    clearStreamingContent: vi.fn(),
    getCurrentTask: vi.fn(() => null),
    getSteps: vi.fn(() => []),
    isSessionLoading: vi.fn(() => false),
    sendTaskMessage: vi.fn(async () => {}),
    stopGeneration: vi.fn(),
    stopViewing: vi.fn(),
    createSession: vi.fn(),
    clearChat: vi.fn()
  })
}
beforeEach(() => {
  tokenStyle = document.createElement('style')
  tokenStyle.textContent = readFileSync('src/styles/tokens.css', 'utf8')
  document.head.append(tokenStyle)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  store = makeStore()
  vi.mocked(useChatStore).mockReturnValue(store as unknown as ReturnType<typeof useChatStore>)
  vi.mocked(uploadChunkedFile).mockResolvedValue({
    fileId: 'attachment-one',
    fileHash: 'hash',
    fileName: 'notes.txt',
    size: 5,
    mimeType: 'text/plain',
    source: 'uploaded'
  })
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
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp(Chat)
  app.mount(root)
  await settle()
  return root
}
function button(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}

describe('chat layout regressions', () => {
  it('passes the research selection from the composer to the store', async () => {
    const root = await mount()
    const picker = root.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    Object.defineProperty(picker, 'files', {
      value: [new File(['notes'], 'notes.txt', { type: 'text/plain' })]
    })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    root.querySelector<HTMLInputElement>('.composer-research input')!.click()
    button('发送消息').click()
    await settle()
    expect(store.sendTaskMessage).toHaveBeenCalledWith(
      '',
      [],
      [expect.objectContaining({ fileId: 'attachment-one' })],
      true
    )
  })
  it('appends a starter to the draft, focuses the composer and never sends automatically', async () => {
    const root = await mount()
    const input = root.querySelector('textarea')!
    input.value = '保留这段背景信息'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    root.querySelector<HTMLButtonElement>('.starter-action')!.click()
    await settle()
    expect(input.value.startsWith('保留这段背景信息\n')).toBe(true)
    expect(input.value).toContain('文档')
    expect(document.activeElement).toBe(input)
    expect(store.sendTaskMessage).not.toHaveBeenCalled()
    button('发送消息').click()
    await settle()
    expect(store.sendTaskMessage).toHaveBeenCalledOnce()
  })

  it('retains the same composer, draft and attachment when empty chat becomes a conversation', async () => {
    const root = await mount()
    const input = root.querySelector('textarea')!
    input.value = '未发送的草稿'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const picker = root.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    Object.defineProperty(picker, 'files', {
      value: [new File(['notes'], 'notes.txt', { type: 'text/plain' })]
    })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    expect(root.querySelector('.file-name')?.textContent).toBe('notes.txt')
    expect(root.querySelector('.is-new-chat')).not.toBeNull()
    store.messages.push({ role: 'assistant', content: '恢复的任务结果' })
    await settle()
    expect(root.querySelector('.is-new-chat')).toBeNull()
    expect(root.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('未发送的草稿')
    expect(root.querySelector('.file-name')?.textContent).toBe('notes.txt')
    button('发送消息').click()
    await settle()
    expect(store.sendTaskMessage).toHaveBeenCalledExactlyOnceWith(
      '未发送的草稿',
      [],
      [expect.objectContaining({ fileId: 'attachment-one' })]
    )
  })

  it('opens a resource page while preserving the composer and returns to chat when restoring a task', async () => {
    const root = await mount()
    expect(document.querySelector('.resource-page')).toBeNull()
    expect(document.querySelector('[data-resource-view]')).toBeNull()
    expect(button('打开任务记录').getAttribute('aria-pressed')).toBe('false')
    const input = root.querySelector('textarea')!
    button('打开任务记录').click()
    await settle()
    expect(
      document
        .querySelector('.resource-page [data-resource-view]')
        ?.getAttribute('data-resource-view')
    ).toBe('tasks')
    expect(root.querySelector('textarea')).toBe(input)
    expect(root.querySelector<HTMLElement>('.chat-stage')?.style.display).toBe('none')
    document.querySelector<HTMLButtonElement>('[data-resource-view] button')!.click()
    await settle()
    expect(store.restoreTask).toHaveBeenCalledExactlyOnceWith('task-one')
    expect(root.querySelector('.resource-page')).toBeNull()
    expect(root.querySelector<HTMLElement>('.chat-stage')?.style.display).not.toBe('none')
    expect(button('打开任务记录').getAttribute('aria-pressed')).toBe('false')
  })

  it('retains a draft while collapsing and expanding the desktop sidebar and restores focus', async () => {
    const root = await mount()
    const input = root.querySelector('textarea')!
    input.value = '保留草稿'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    button('收起侧栏').click()
    await settle()
    expect(root.querySelector('.sidebar-collapsed')).not.toBeNull()
    expect(document.activeElement).toBe(button('打开侧栏'))
    button('打开侧栏').click()
    await settle()
    expect(root.querySelector('.sidebar-collapsed')).toBeNull()
    expect(document.activeElement).toBe(button('收起侧栏'))
    expect(root.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('保留草稿')
  })

  it('returns to chat for a new session and closes the header menu', async () => {
    const root = await mount()
    button('收起侧栏').click()
    await settle()
    const menu = root.querySelector<HTMLDetailsElement>('.header-menu')!
    menu.open = true
    button('打开文件').click()
    await settle()
    expect(root.querySelector('.resource-page')).not.toBeNull()
    menu.open = true
    button('新对话').click()
    await settle()
    expect(store.createSession).toHaveBeenCalledOnce()
    expect(menu.open).toBe(false)
    expect(root.querySelector('.resource-page')).toBeNull()
    button('打开文件').click()
    await settle()
    store.currentSessionId = 'session-two'
    await settle()
    expect(root.querySelector('.resource-page')).toBeNull()
  })

  it('keeps the resource page when dismissing mobile navigation', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
    const root = await mount()
    button('打开文件').click()
    await settle()
    const trigger = button('打开侧栏')
    trigger.focus()
    trigger.click()
    await settle()
    button('关闭会话导航').click()
    await settle()
    expect(root.querySelector('.sidebar.is-open')).toBeNull()
    expect(root.querySelector('.resource-page')).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('focuses a visible mobile control rather than the hidden desktop collapse button', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.classList.contains('sidebar-collapse') ? null : document.body
    })
    const root = await mount()
    const trigger = button('打开侧栏')
    trigger.focus()
    trigger.click()
    await settle()
    expect(document.activeElement).toBe(button('关闭会话导航'))
    button('关闭会话导航').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )
    await settle()
    expect(root.querySelector('.sidebar.is-open')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
