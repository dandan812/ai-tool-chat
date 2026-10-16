import { describe, expect, it } from 'vitest'
import type { ImageData, UploadedFileRef } from '../types/task'
import {
  buildMessageAttachments,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_MESSAGE_ATTACHMENTS,
  normalizeMessageAttachments,
  presentMessageAttachment
} from './messageAttachments'

describe('bounded local attachment metadata', () => {
  it('keeps names, kinds and sizes without retaining originals or preview URLs', () => {
    const image: ImageData = {
      id: 'image',
      base64: 'original-image-content',
      mimeType: 'image/png',
      description: 'figure.png',
      localAttachment: { kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 2048 }
    }
    const file: UploadedFileRef = {
      fileId: 'file',
      fileName: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 5120,
      fileHash: 'hash',
      source: 'uploaded'
    }
    Object.assign(image.localAttachment!, {
      thumbnailUrl: 'data:image/png;base64,original-image-content',
      previewUrl: 'blob:revoked',
      file: new File(['original'], 'figure.png'),
      base64: image.base64
    })
    const attachments = buildMessageAttachments([image], [file])
    expect(attachments).toEqual([
      { kind: 'image', name: 'figure.png', mimeType: 'image/png', size: 2048 },
      { kind: 'file', name: 'report.docx', mimeType: file.mimeType, size: 5120 }
    ])
    const serialized = JSON.stringify(attachments)
    for (const value of ['original-image-content', 'blob:', 'data:', 'fileHash', 'fileId']) {
      expect(serialized).not.toContain(value)
    }
    expect(presentMessageAttachment(attachments[0]!)).toBe('PNG · 2 KB')
    expect(presentMessageAttachment(attachments[1]!)).toBe('DOCX · 5 KB')
  })

  it('validates restored containers, types, lengths and sizes and ignores all URL fields', () => {
    expect(normalizeMessageAttachments({ kind: 'file' })).toEqual([])
    expect(normalizeMessageAttachments([null, 4, { kind: 'other' }])).toEqual([])
    const attachments = normalizeMessageAttachments([
      {
        kind: 'image',
        name: 'x'.repeat(MAX_ATTACHMENT_NAME_LENGTH + 100),
        mimeType: 'image/png',
        size: -1,
        thumbnailUrl: 'https://untrusted.example/remote.png'
      },
      { kind: 'file', name: '\u0000bad\u001fname.txt', mimeType: 'text/plain', size: NaN },
      { kind: 'file', name: 'size.txt', mimeType: 'data:text/plain', size: Infinity },
      { kind: 'image', name: '', mimeType: 'image/' + 'a'.repeat(129), size: 1.5 },
      { kind: 'file', name: 'zero.txt', mimeType: 'TEXT/PLAIN', size: 0 }
    ])
    expect(attachments[0]!.name).toHaveLength(MAX_ATTACHMENT_NAME_LENGTH)
    expect(attachments[0]!.size).toBeUndefined()
    expect(attachments[1]!.name).toBe('badname.txt')
    expect(attachments[2]!.mimeType).toBe('')
    expect(attachments[3]).toEqual({ kind: 'image', name: '图片', mimeType: '' })
    expect(attachments[4]).toEqual({
      kind: 'file',
      name: 'zero.txt',
      mimeType: 'text/plain',
      size: 0
    })
    expect(presentMessageAttachment(attachments[4]!)).toBe('TXT · 0 B')
    expect(JSON.stringify(attachments)).not.toContain('untrusted.example')
    expect(
      normalizeMessageAttachments(
        Array.from({ length: MAX_MESSAGE_ATTACHMENTS + 1 }, () => ({ kind: 'file', name: 'a.txt' }))
      )
    ).toHaveLength(MAX_MESSAGE_ATTACHMENTS)
  })

  it('falls back for callers without prepared metadata and avoids inventing a size', () => {
    const attachments = buildMessageAttachments(
      [{ id: 'image', mimeType: 'image/jpeg', base64: 'original', description: 'camera.jpg' }],
      []
    )
    expect(attachments).toEqual([{ kind: 'image', name: 'camera.jpg', mimeType: 'image/jpeg' }])
    expect(presentMessageAttachment(attachments[0]!)).toBe('JPG')
    expect(
      presentMessageAttachment({
        kind: 'file',
        name: 'large.bin',
        mimeType: '',
        size: Number.MAX_SAFE_INTEGER
      })
    ).not.toContain('undefined')
  })
})
