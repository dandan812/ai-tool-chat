import { describe, expect, it } from 'vitest'
import {
  isSupportedTextFile,
  isSupportedUploadFile,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_TEXT_TYPES,
  SUPPORTED_UPLOAD_ACCEPT
} from './file'

const documents = [
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
]

describe('document upload eligibility', () => {
  it.each(documents)('accepts %s by MIME or case-insensitive extension', (extension, type) => {
    for (const [name, mimeType] of [
      [`report.${extension}`, type],
      [`report.${extension}`, ''],
      [`REPORT.${extension.toUpperCase()}`, ''],
      [`REPORT.${extension.toUpperCase()}`, 'application/octet-stream'],
      ['clipboard-file', type]
    ]) {
      const file = new File([new Uint8Array([0, 255, 128])], name!, { type: mimeType })
      expect(isSupportedUploadFile(file), `${name} (${mimeType})`).toBe(true)
      expect(isSupportedTextFile(file), `${name} must not become a text file`).toBe(false)
    }
  })

  it('retains every supported text and code extension and MIME in the picker', () => {
    const accept = SUPPORTED_UPLOAD_ACCEPT.split(',')
    for (const extension of SUPPORTED_EXTENSIONS) {
      const file = new File(['content'], `source.${extension.toUpperCase()}`)
      expect(isSupportedTextFile(file), extension).toBe(true)
      expect(isSupportedUploadFile(file), extension).toBe(true)
      expect(accept, extension).toContain(`.${extension}`)
    }
    for (const type of SUPPORTED_TEXT_TYPES) {
      const file = new File(['content'], 'clipboard-file', { type })
      expect(isSupportedUploadFile(file), type).toBe(true)
      expect(accept, type).toContain(type)
    }
  })

  it('includes both the extensions and MIME types for documents in the picker', () => {
    const accept = SUPPORTED_UPLOAD_ACCEPT.split(',')
    for (const [extension, type] of documents) {
      expect(accept).toContain(`.${extension}`)
      expect(accept).toContain(type)
    }
  })

  it.each([
    ['program.exe', 'application/octet-stream'],
    ['archive.zip', 'application/zip'],
    ['slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['unknown', ''],
    ['figure.png', 'image/png'],
    ['figure.jpg', 'image/jpeg'],
    ['figure.pdf', 'image/png'],
    ['figure.doc', 'image/jpeg'],
    ['figure.docx', 'image/png'],
    ['figure.xls', 'image/webp'],
    ['figure.xlsx', 'image/svg+xml'],
    ['figure.svg', 'image/png']
  ])('rejects unsupported or image input %s', (name, type) => {
    expect(isSupportedUploadFile(new File(['content'], name, { type }))).toBe(false)
  })

  it.each(['figure.svg', 'FIGURE.SVG'])('retains %s as text/code upload with SVG MIME', (name) => {
    const svg = new File(['<svg/>'], name, { type: 'image/svg+xml' })
    expect(isSupportedTextFile(svg)).toBe(true)
    expect(isSupportedUploadFile(svg)).toBe(true)
  })
})
