import { describe, expect, it } from 'vitest'
import { applyTaskSnapshot, appendMessageError, findMessage, mergeSources } from './messageUpdates'
import type { ChatMessage, EvidenceSource, Task } from '../../types/task'

const source: EvidenceSource = {
  sourceId: 'source-1',
  fileId: 'file-1',
  fileName: 'notes.txt',
  fileHash: 'hash',
  excerpt: 'original',
  startLine: 1,
  endLine: 1,
  startOffset: 0,
  endOffset: 8
}
const task: Task = {
  id: 'task-1',
  type: 'file',
  status: 'running',
  userMessage: 'question',
  steps: [],
  createdAt: 1,
  updatedAt: 2
}
describe('message event updates without request side effects', () => {
  it('locates a message by identity rather than position', () => {
    const messages: ChatMessage[] = [
      { id: 'first', role: 'user', content: 'question' },
      { id: 'answer', role: 'assistant', content: 'partial' }
    ]
    messages.shift()
    expect(findMessage(messages, 'answer')).toBe(messages[0])
    messages.pop()
    expect(findMessage(messages, 'answer')).toBeUndefined()
  })

  it('merges source replays by source ID without duplicates or modifying inputs', () => {
    const current = [source]
    const incoming = [
      { ...source, excerpt: 'updated' },
      { ...source, sourceId: 'source-2' }
    ]
    const merged = mergeSources(current, incoming)
    expect(merged.map((item) => item.sourceId)).toEqual(['source-1', 'source-2'])
    expect(merged[0]!.excerpt).toBe('updated')
    expect(current[0]!.excerpt).toBe('original')
    expect(incoming).toHaveLength(2)
  })

  it('a running task snapshot never overwrites streamed content and final partial data is authoritative', () => {
    const message: ChatMessage = { role: 'assistant', content: 'streamed', sources: [source] }
    applyTaskSnapshot(message, {
      ...task,
      result: 'stale partial',
      metadata: { sources: [source] }
    })
    expect(message.content).toBe('streamed')
    applyTaskSnapshot(message, {
      ...task,
      status: 'failed',
      result: 'saved partial',
      error: 'failed'
    })
    appendMessageError(message, 'failed')
    expect(message.content).toBe('saved partial\n\nfailed')
    expect(message.sources).toEqual([source])
    expect(message.taskId).toBe('task-1')
  })

  it('retains partial content when an old failed task has no result snapshot', () => {
    const message: ChatMessage = { role: 'assistant', content: 'partial' }
    applyTaskSnapshot(message, { ...task, status: 'failed', error: 'failed' })
    expect(message.content).toBe('partial\n\nfailed')
  })
})
