import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceSource, MessageAttachment, TaskMetrics } from '../types/task'
import ChatMessage from './ChatMessage.vue'

vi.mock('../stores/chat', () => ({
  useChatStore: () => ({ currentSessionId: 'offline-test', isSessionLoading: () => false })
}))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})
const source: EvidenceSource = {
  sourceId: 'message-source',
  fileId: 'file',
  fileHash: 'hash',
  fileName: 'notes.txt',
  excerpt: 'Exact original text.',
  startLine: 2,
  endLine: 2,
  startOffset: 8,
  endOffset: 28
}
const metrics: TaskMetrics = {
  elapsedMs: 1000,
  firstContentMs: 500,
  modelCalls: 1,
  inputTokens: 20,
  outputTokens: 10,
  tokenSource: 'estimated',
  estimatedCost: null,
  currency: null,
  costSource: 'unknown'
}

describe('ChatMessage evidence wiring', () => {
  it('copies the original message and reports clipboard failure without changing content', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('clipboard unavailable'))
      .mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () => h(ChatMessage, { role: 'assistant', content: '**原始 Markdown**', index: 0 })
    })
    app.mount(root)
    root.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')!.click()
    await nextTick()
    await nextTick()
    expect(root.querySelector('[role="status"]')?.textContent).toBe('复制失败，请重试')
    root.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')!.click()
    await nextTick()
    await nextTick()
    expect(writeText).toHaveBeenLastCalledWith('**原始 Markdown**')
    expect(root.querySelector('[aria-label="已复制"]')).not.toBeNull()
    expect(root.querySelector('[role="status"]')).toBeNull()
    expect(root.querySelector('.markdown-body')?.textContent?.trim()).toBe('原始 Markdown')
  })
  it('opens the actual source panel from an answer citation and displays honest metrics', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () =>
        h(ChatMessage, {
          role: 'assistant',
          content: 'Conclusion [S:message-source]',
          index: 0,
          sources: [source],
          metrics
        })
    })
    app.mount(root)
    root.querySelector<HTMLButtonElement>('.evidence-citation')!.click()
    await nextTick()
    await nextTick()
    expect(root.querySelector('.source-excerpt pre')?.textContent).toBe(source.excerpt)
    expect(root.querySelector('.task-metrics')?.textContent).toContain('估算')
    expect(root.querySelector('.task-metrics')?.textContent).toContain('未知')
  })
  it('preserves a user-typed citation example instead of activating or rewriting it', () => {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () =>
        h(ChatMessage, {
          role: 'user',
          content: '[S:message-source]',
          index: 0,
          sources: [source],
          metrics
        })
    })
    app.mount(root)
    expect(root.querySelector('.markdown-body')?.textContent).toContain('[S:message-source]')
    expect(
      root.querySelector('.evidence-citation, .evidence-invalid, .evidence-sources, .task-metrics')
    ).toBeNull()
  })
})

describe('user message attachment presentation', () => {
  const attachments: MessageAttachment[] = [
    { kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 2048 },
    { kind: 'file', name: 'report.docx', mimeType: 'application/msword', size: 5120 }
  ]
  function mount(content: string, attachmentOnly = false, items = attachments) {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      render: () =>
        h(ChatMessage, {
          role: 'user',
          content,
          index: 0,
          attachments: items,
          attachmentOnly
        })
    })
    app.mount(root)
    return root
  }

  it('shows mixed attachment names and metadata alongside the original message', () => {
    const root = mount('请分析这两个附件')
    expect(root.querySelectorAll('.message-attachment')).toHaveLength(2)
    expect(root.querySelector('.message-attachments')?.textContent).toContain('figure.png')
    expect(root.querySelector('.message-attachments')?.textContent).toContain('report.docx')
    expect(root.querySelector('.message-attachments')?.textContent).toContain('PNG · 2 KB')
    expect(root.querySelector('.message-attachments')?.textContent).toContain('DOCX · 5 KB')
    expect(root.querySelector('.markdown-body')?.textContent?.trim()).toBe('请分析这两个附件')
    const list = root.querySelector('.message-attachments')!
    const bubble = root.querySelector('.bubble')!
    expect(list.parentElement).toBe(root.querySelector('.message-frame'))
    expect(bubble.contains(list)).toBe(false)
    expect(list.nextElementSibling).toBe(bubble)
  })

  it.each(['[图片]', '[文件: report.docx]'])(
    'omits the generated %s marker and copies filenames for attachment-only messages',
    async (content) => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
      const root = mount(content, true)
      expect(root.querySelector('.markdown-body')).toBeNull()
      expect(root.querySelector('.bubble')).toBeNull()
      expect(root.querySelector('.message-attachments')).not.toBeNull()
      root.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')!.click()
      await nextTick()
      expect(writeText).toHaveBeenCalledWith('figure.png\nreport.docx')
    }
  )

  it.each([
    { name: 'old history', items: [] },
    { name: 'typed marker text', items: attachments }
  ])('preserves $name without treating it as a generated marker', ({ items }) => {
    const root = mount('[图片]', false, items)
    expect(root.querySelector('.markdown-body')?.textContent?.trim()).toBe('[图片]')
    expect(root.querySelectorAll('.message-attachment')).toHaveLength(items.length)
  })

  it('never renders restored URLs, original image data or filename HTML as media', () => {
    const restored = JSON.parse(
      JSON.stringify([
        {
          kind: 'image',
          name: '<img src=x onerror=alert(1)>.png',
          mimeType: 'image/png',
          size: 10,
          previewUrl: 'blob:revoked',
          thumbnailUrl: 'https://untrusted.example/image.png',
          base64: 'original-image'
        }
      ])
    ) as MessageAttachment[]
    const root = mount('[图片]', true, restored)
    expect(root.querySelector('.message-attachment-name')?.textContent).toBe(
      '<img src=x onerror=alert(1)>.png'
    )
    expect(root.querySelector('img, a[href]')).toBeNull()
    expect(root.innerHTML).not.toContain('blob:revoked')
    expect(root.innerHTML).not.toContain('untrusted.example')
    expect(root.innerHTML).not.toContain('original-image')
  })
})
