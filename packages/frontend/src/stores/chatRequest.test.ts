import { describe, expect, it } from 'vitest'
import type { ChatMessage, ImageData } from '../types/task'
import { buildRequestImages, buildRequestMessages } from './chatRequest'

describe('attachment request boundary', () => {
  it('whitelists both current and historical messages without changing content', () => {
    const message: ChatMessage = {
      id: 'local-id',
      role: 'user',
      content: '[图片]',
      attachments: [{ kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 42 }],
      attachmentOnly: true
    }
    expect(
      buildRequestMessages([message, { role: 'assistant', content: 'answer' }], message)
    ).toEqual([
      { role: 'user', content: '[图片]' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: '[图片]' }
    ])
    expect(message.attachments).toHaveLength(1)
  })

  it('preserves original image transport fields and excludes all local presentation data', () => {
    const image: ImageData = {
      id: 'image',
      base64: 'full-original-image',
      mimeType: 'image/png',
      description: 'figure.png',
      file: new File(['original'], 'figure.png'),
      localAttachment: { kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 8 }
    }
    Object.assign(image, {
      previewUrl: 'blob:revoked',
      thumbnailUrl: 'data:image/png;base64,local'
    })
    expect(buildRequestImages([image])).toEqual([
      {
        id: 'image',
        base64: 'full-original-image',
        mimeType: 'image/png',
        description: 'figure.png'
      }
    ])
    expect(image.localAttachment).toBeDefined()
    expect(
      buildRequestImages([{ id: 'bare', base64: 'original', mimeType: 'image/webp' }])
    ).toEqual([{ id: 'bare', base64: 'original', mimeType: 'image/webp' }])
  })
})
