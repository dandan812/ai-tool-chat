import { describe, expect, it, vi } from 'vitest'
import type { SkillContext, UploadedFileRef } from '../types'
import { WorkerError } from '../types'
import { createMockEnv } from '../test/mocks'
import { fileSkill } from './fileSkill'

const hash = 'a'.repeat(64)
const files: UploadedFileRef[] = ['first', 'second'].map((fileId) => ({
  fileId,
  fileName: fileId + '.pdf',
  mimeType: 'application/pdf',
  size: 4,
  fileHash: hash,
  source: 'uploaded'
}))

describe('document batch failure and cancellation', () => {
  it.each(['failure', 'cancellation'])(
    'does not start remaining document parsing after %s',
    async (mode) => {
      const controller = new AbortController()
      const error =
        mode === 'failure'
          ? new WorkerError('PDF 无可提取文字，请先 OCR。', 'DOCUMENT_NO_TEXT', 422)
          : new Error('TASK_CANCELLED')
      const extract = vi.fn(async (_bytes, _file, signal: AbortSignal) => {
        expect(signal).toBe(controller.signal)
        if (mode === 'cancellation') controller.abort(error)
        throw error
      })
      const env = createMockEnv({
        EXTRACT_DOCUMENT_TEXT: extract,
        RUNTIME_CONTROL: {
          signal: controller.signal,
          beforeCall: async () => {},
          afterCall: async () => {}
        }
      })
      for (const file of files) {
        await env.UPLOADED_FILES.put(
          'uploaded-files/' + file.fileId,
          new Uint8Array([0, 255, 128, 10]),
          { customMetadata: { serverContentHash: hash } }
        )
      }
      const context = { env } as SkillContext
      const stream = fileSkill.execute(
        { messages: [{ role: 'user', content: '分析两个文件' }], files },
        context
      )
      const execution = stream[Symbol.asyncIterator]()
      expect((await execution.next()).value).toMatchObject({ type: 'progress' })
      await expect(execution.next()).rejects.toBe(error)
      expect(extract).toHaveBeenCalledTimes(1)
      expect(extract.mock.calls[0][1]).toMatchObject({ fileId: 'first' })
    }
  )
})
