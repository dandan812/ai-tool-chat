import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadChatStorage,
  saveChatStorage,
  sanitizeRestoredMessages,
  sanitizeRestoredMessagesMap,
  STORAGE_KEYS
} from './chatStorage'
import type { ChatMessage } from '../types/task'
import { accountStorageKey, setStorageAccount } from '../api/account'

describe('chatStorage', () => {
  it('应该移除恢复后尾部残留的空 assistant 占位消息', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '已生成一半' },
      { role: 'assistant', content: '   ' }
    ]

    expect(sanitizeRestoredMessages(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '已生成一半' }
    ])
  })

  it('应该保留中间位置的空 assistant 消息，只清理尾部占位', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '' },
      { role: 'user', content: '第二条' }
    ]

    expect(sanitizeRestoredMessages(messages)).toEqual(messages)
  })

  it('应该批量清洗所有会话的恢复消息', () => {
    expect(
      sanitizeRestoredMessagesMap({
        a: [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: '' }
        ],
        b: [
          { role: 'user', content: 'B' },
          { role: 'assistant', content: '正常回复' }
        ]
      })
    ).toEqual({
      a: [{ role: 'user', content: 'A' }],
      b: [
        { role: 'user', content: 'B' },
        { role: 'assistant', content: '正常回复' }
      ]
    })
  })
})

describe('account-scoped history compatibility', () => {
  const sessions = [{ id: 'session-1', title: 'history', createdAt: 1, updatedAt: 2 }]
  beforeEach(() => {
    localStorage.clear()
    setStorageAccount('alice')
  })

  it('retains empty recoverable task messages but removes anonymous trailing placeholders', () => {
    expect(
      sanitizeRestoredMessages([
        { role: 'assistant', content: '', taskId: 'task-1' },
        { role: 'assistant', content: '', requestKey: 'request-1' },
        { role: 'assistant', content: '' }
      ])
    ).toEqual([
      { role: 'assistant', content: '', taskId: 'task-1' },
      { role: 'assistant', content: '', requestKey: 'request-1' }
    ])
  })

  it('loads the old array/map format, assigns stable IDs, and falls back from an invalid current session', () => {
    saveChatStorage(
      sessions,
      {
        'session-1': [
          { role: 'user', content: 'question' },
          { role: 'assistant', content: '', taskId: 'task-1' }
        ]
      },
      'missing-session'
    )
    const restored = loadChatStorage()!
    expect(restored.currentSessionId).toBe('session-1')
    const messages = restored.messagesMap['session-1']!
    expect(messages).toHaveLength(2)
    expect(messages[0]!.id).toEqual(expect.any(String))
    expect(messages[1]!.id).not.toBe(messages[0]!.id)
    saveChatStorage(restored.sessionList, restored.messagesMap, restored.currentSessionId)
    expect(loadChatStorage()?.messagesMap).toEqual(restored.messagesMap)
  })

  it('repairs duplicate message IDs and drops malformed messages without dropping the whole session', () => {
    localStorage.setItem(accountStorageKey(STORAGE_KEYS.SESSION_LIST), JSON.stringify(sessions))
    localStorage.setItem(
      accountStorageKey(STORAGE_KEYS.MESSAGES_MAP),
      JSON.stringify({
        'session-1': [
          null,
          { role: 'other', content: 'invalid' },
          { role: 'user', content: 42 },
          { id: 'duplicate', role: 'user', content: 'question' },
          { id: 'duplicate', role: 'assistant', content: 'answer' }
        ]
      })
    )
    const messages = loadChatStorage()!.messagesMap['session-1']!
    expect(messages.map((message) => message.content)).toEqual(['question', 'answer'])
    expect(new Set(messages.map((message) => message.id)).size).toBe(2)
  })

  it('does not import another account or old anonymous storage into a logged-in account', () => {
    saveChatStorage(
      sessions,
      { 'session-1': [{ role: 'user', content: 'alice question' }] },
      'session-1'
    )
    localStorage.setItem(STORAGE_KEYS.SESSION_LIST, JSON.stringify(sessions))
    localStorage.setItem(
      STORAGE_KEYS.MESSAGES_MAP,
      JSON.stringify({ 'session-1': [{ role: 'user', content: 'anonymous' }] })
    )
    setStorageAccount('bob')
    expect(loadChatStorage()).toBeNull()
    expect(localStorage.getItem(STORAGE_KEYS.MESSAGES_MAP)).toContain('anonymous')
    setStorageAccount('alice')
    expect(loadChatStorage()!.messagesMap['session-1']![0]!.content).toBe('alice question')
  })

  it('rejects invalid session and message containers', () => {
    localStorage.setItem(
      accountStorageKey(STORAGE_KEYS.SESSION_LIST),
      JSON.stringify([{ id: 'bad' }])
    )
    localStorage.setItem(accountStorageKey(STORAGE_KEYS.MESSAGES_MAP), '{}')
    expect(loadChatStorage()).toBeNull()
    localStorage.setItem(accountStorageKey(STORAGE_KEYS.SESSION_LIST), JSON.stringify(sessions))
    localStorage.setItem(accountStorageKey(STORAGE_KEYS.MESSAGES_MAP), 'null')
    expect(loadChatStorage()).toBeNull()
  })
})
