import type { UploadedFileRef } from '../types'
import { isSupportedTextFile } from './textFormat'

export type DocumentFormat = 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx'

const DOCUMENT_MIME_TYPES: Record<string, DocumentFormat> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx'
}

export function getDocumentFormat(
  file: Pick<UploadedFileRef, 'fileName' | 'mimeType'>
): DocumentFormat | undefined {
  const extension = file.fileName.split('.').pop()?.toLowerCase()
  if (extension && ['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
    return extension as DocumentFormat
  }
  // Browsers can label CSV as Excel; known text extensions retain the text path.
  if (isSupportedTextFile(file.fileName) || file.mimeType.toLowerCase().startsWith('text/')) {
    return undefined
  }
  return DOCUMENT_MIME_TYPES[file.mimeType.toLowerCase()]
}
