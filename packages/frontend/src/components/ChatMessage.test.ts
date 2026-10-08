import { createApp, h, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceSource, TaskMetrics } from '../types/task'
import ChatMessage from './ChatMessage.vue'

vi.mock('../stores/chat', () => ({ useChatStore: () => ({ currentSessionId: 'offline-test', isSessionLoading: () => false }) }))
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = '' })
const source: EvidenceSource = { sourceId: 'message-source', fileId: 'file', fileHash: 'hash', fileName: 'notes.txt', excerpt: 'Exact original text.', startLine: 2, endLine: 2, startOffset: 8, endOffset: 28 }
const metrics: TaskMetrics = { elapsedMs: 1000, firstContentMs: 500, modelCalls: 1, inputTokens: 20, outputTokens: 10, tokenSource: 'estimated', estimatedCost: null, currency: null, costSource: 'unknown' }

describe('ChatMessage evidence wiring', () => {
  it('opens the actual source panel from an answer citation and displays honest metrics', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(ChatMessage, { role: 'assistant', content: 'Conclusion [S:message-source]', index: 0, sources: [source], metrics }) })
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
    app = createApp({ render: () => h(ChatMessage, { role: 'user', content: '[S:message-source]', index: 0, sources: [source], metrics }) })
    app.mount(root)
    expect(root.querySelector('.markdown-body')?.textContent).toContain('[S:message-source]')
    expect(root.querySelector('.evidence-citation, .evidence-invalid, .evidence-sources, .task-metrics')).toBeNull()
  })
})
