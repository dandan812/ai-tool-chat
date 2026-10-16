import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraftImages,
  resolveDraftImage,
  saveDraftImage,
  syncDraftImageRefs
} from './draftImageStore'
import { buildMessageAttachments } from './messageAttachments'
import { loadChatStorage, saveChatStorage } from '../stores/chatStorage'
import { setStorageAccount } from '../api/account'

beforeEach(() => {
  localStorage.clear()
  setStorageAccount('attachment-test')
  vi.stubGlobal('indexedDB', undefined)
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:draft-preview'),
    revokeObjectURL: vi.fn()
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('draft image metadata preparation', () => {
  it('reads the real blob size and persists only metadata after revoking the draft preview', async () => {
    const original = 'synthetic-original-image-without-a-thumbnail'
    const image = await saveDraftImage(new File([original], 'figure.png', { type: 'image/png' }))
    syncDraftImageRefs('session', [image])
    const resolved = await resolveDraftImage(image)
    expect(resolved.base64).toBe(btoa(original))
    expect(resolved.localAttachment).toEqual({
      kind: 'image',
      name: 'figure.png',
      mimeType: 'image/png',
      size: original.length
    })
    const attachments = buildMessageAttachments([resolved], [])
    saveChatStorage(
      [{ id: 'session', title: 'attachments', createdAt: 1, updatedAt: 2 }],
      { session: [{ role: 'user', content: '[图片]', attachments, attachmentOnly: true }] },
      'session'
    )
    await clearDraftImages([image])
    syncDraftImageRefs('session', [])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:draft-preview')
    await expect(resolveDraftImage(image)).rejects.toThrow('草稿图片已丢失')
    expect(loadChatStorage()?.messagesMap.session?.[0]?.attachments).toEqual(attachments)
    for (let index = 0; index < localStorage.length; index++) {
      const stored = localStorage.getItem(localStorage.key(index)!)!
      expect(stored).not.toContain(resolved.base64)
      expect(stored).not.toContain('blob:draft-preview')
    }
  })
})
