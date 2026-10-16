import { describe, expect, it, vi } from 'vitest'
import type { UploadedFileRef } from '../types'
import { WorkerError } from '../types'
import { createMockEnv } from '../test/mocks'
import { getUploadedFileContent } from './uploadedFileStorage'
import { getDocumentFormat } from './documentFormat'

const hash = 'a'.repeat(64)
const ref = (fileName: string, mimeType = ''): UploadedFileRef => ({
  fileId: 'owned-synthetic',
  fileName,
  mimeType,
  size: 4,
  fileHash: hash,
  source: 'uploaded'
})

describe('uploaded document routing', () => {
  it.each([
    ['contract.PDF', '', 'pdf'],
    ['contract.doc', 'application/octet-stream', 'doc'],
    ['contract.docx', '', 'docx'],
    ['budget.xls', '', 'xls'],
    ['budget.XLSX', '', 'xlsx'],
    ['clipboard', 'application/pdf', 'pdf'],
    [
      'clipboard',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx'
    ],
    ['clipboard', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx']
  ])(
    'routes %s using authoritative metadata and the original bytes',
    async (name, mime, format) => {
      const bytes = new Uint8Array([0, 255, 128, 10])
      const extract = vi.fn(async () => '已提取的中文正文。\n表格内容。')
      const env = createMockEnv({ EXTRACT_DOCUMENT_TEXT: extract })
      const file = ref(name, mime)
      await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, bytes, {
        customMetadata: { serverContentHash: hash }
      })
      expect(getDocumentFormat(file)).toBe(format)
      const result = await getUploadedFileContent(env, file)
      expect(extract).toHaveBeenCalledExactlyOnceWith(bytes, file, undefined)
      expect(result).toEqual({ ...file, content: '已提取的中文正文。\n表格内容。' })
    }
  )

  it('keeps the existing text path, including original CRLF and Unicode', async () => {
    const extract = vi.fn()
    const env = createMockEnv({ EXTRACT_DOCUMENT_TEXT: extract })
    const file = ref('notes.txt', 'text/plain')
    await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, '原文😀\r\n第二行', {
      customMetadata: { serverContentHash: hash }
    })
    expect((await getUploadedFileContent(env, file)).content).toBe('原文😀\r\n第二行')
    expect(extract).not.toHaveBeenCalled()
  })

  it.each([
    ['budget.CSV', 'application/vnd.ms-excel'],
    ['source.TSX', 'application/pdf'],
    ['drawing.SVG', 'application/msword'],
    ['notes', 'text/plain']
  ])('keeps %s on the text path when document MIME metadata is misleading', async (name, mime) => {
    const extract = vi.fn()
    const env = createMockEnv({ EXTRACT_DOCUMENT_TEXT: extract })
    const file = ref(name, mime)
    await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, '原文\r\n第二行', {
      customMetadata: { serverContentHash: hash }
    })
    expect(getDocumentFormat(file)).toBeUndefined()
    expect((await getUploadedFileContent(env, file)).content).toBe('原文\r\n第二行')
    expect(extract).not.toHaveBeenCalled()
  })

  it('checks the server file version before calling the document parser', async () => {
    const extract = vi.fn()
    const env = createMockEnv({ EXTRACT_DOCUMENT_TEXT: extract })
    const file = ref('notes.pdf')
    await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, 'replaced', {
      customMetadata: { serverContentHash: 'b'.repeat(64) }
    })
    await expect(getUploadedFileContent(env, file)).rejects.toMatchObject({
      code: 'FILE_VERSION_CHANGED'
    })
    expect(extract).not.toHaveBeenCalled()
  })

  it('never falls back to decoding binary when a runtime has no document parser', async () => {
    const env = createMockEnv()
    const file = ref('notes.pdf')
    await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, new Uint8Array([0, 255]), {
      customMetadata: { serverContentHash: hash }
    })
    await expect(getUploadedFileContent(env, file)).rejects.toMatchObject({
      code: 'DOCUMENT_PARSER_UNAVAILABLE'
    })
  })

  it('preserves actionable parser errors and the actual cancellation signal', async () => {
    const controller = new AbortController()
    const failure = new WorkerError('PDF 没有可提取文字，请先 OCR。', 'DOCUMENT_NO_TEXT', 422)
    const extract = vi.fn(async () => {
      throw failure
    })
    const env = createMockEnv({
      EXTRACT_DOCUMENT_TEXT: extract,
      RUNTIME_CONTROL: {
        signal: controller.signal,
        beforeCall: async () => {},
        afterCall: async () => {}
      }
    })
    const file = ref('notes.pdf')
    await env.UPLOADED_FILES.put('uploaded-files/' + file.fileId, new Uint8Array([0, 255]), {
      customMetadata: { serverContentHash: hash }
    })
    await expect(getUploadedFileContent(env, file)).rejects.toBe(failure)
    expect(extract.mock.calls[0]?.[2]).toBe(controller.signal)
    controller.abort(new Error('Cancelled before parsing'))
    extract.mockClear()
    await expect(getUploadedFileContent(env, file)).rejects.toThrow('Cancelled before parsing')
    expect(extract).not.toHaveBeenCalled()
  })
})
