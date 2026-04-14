import { describe, expect, it } from 'vitest'
import { sanitizeRestoredMessages, sanitizeRestoredMessagesMap } from './chatStorage'
import type { ChatMessage } from '../types/task'

describe('chatStorage', () => {
  it('应该移除恢复后尾部残留的空 assistant 占位消息', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '已生成一半' },
      { role: 'assistant', content: '   ' },
    ]

    expect(sanitizeRestoredMessages(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '已生成一半' },
    ])
  })

  it('应该保留中间位置的空 assistant 消息，只清理尾部占位', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '第二条' },
    ]

    expect(sanitizeRestoredMessages(messages)).toEqual(messages)
  })

  it('应该批量清洗所有会话的恢复消息', () => {
    expect(
      sanitizeRestoredMessagesMap({
        a: [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: '' },
        ],
        b: [
          { role: 'user', content: 'B' },
          { role: 'assistant', content: '正常回复' },
        ],
      }),
    ).toEqual({
      a: [{ role: 'user', content: 'A' }],
      b: [
        { role: 'user', content: 'B' },
        { role: 'assistant', content: '正常回复' },
      ],
    })
  })
})
