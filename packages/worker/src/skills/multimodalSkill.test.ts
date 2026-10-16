import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockEnv } from '../test/mocks'
import type { SkillContext, SkillStreamChunk } from '../types'
import { multimodalSkill } from './multimodalSkill'

afterEach(() => vi.unstubAllGlobals())

describe('joint image and file answers', () => {
  it('sends the actual image and verified file excerpts together and emits sources before the answer', async () => {
    const env = createMockEnv({ QWEN_API_KEY: 'offline-test' })
    const file = {
      fileId: 'owned-file',
      fileName: 'notes.txt',
      fileHash: 'a'.repeat(64),
      source: 'uploaded' as const,
      size: 24,
      mimeType: 'text/plain'
    }
    await env.UPLOADED_FILES.put('uploaded-files/owned-file', 'deployment region: Tokyo.', {
      customMetadata: { serverContentHash: file.fileHash }
    })
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          'data: {"choices":[{"delta":{"content":"offline answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        )
    )
    vi.stubGlobal('fetch', fetch)
    const chunks: SkillStreamChunk[] = []
    for await (const chunk of multimodalSkill.execute(
      {
        messages: [{ role: 'user', content: 'Compare the screenshot and deployment notes' }],
        images: [{ id: 'picture', base64: 'AAAA', mimeType: 'image/png' }],
        files: [file]
      },
      { env } as SkillContext
    ))
      chunks.push(chunk)
    const body = JSON.parse(String(fetch.mock.calls[0][1].body))
    expect(body.messages.at(-1).content).toEqual(
      expect.arrayContaining([
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        { type: 'text', text: expect.stringContaining('deployment region: Tokyo.') }
      ])
    )
    expect(body.messages[0].content).toContain('图片观察不能冒用文件引用')
    expect(chunks.findIndex((chunk) => chunk.type === 'sources')).toBeLessThan(
      chunks.findIndex((chunk) => chunk.type === 'content')
    )
    expect(chunks.find((chunk) => chunk.type === 'sources')?.sources?.[0].fileHash).toBe(
      file.fileHash
    )
  })
})
