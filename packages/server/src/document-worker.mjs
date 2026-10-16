import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import WordExtractor from 'word-extractor'
import * as XLSX from 'xlsx'
import { getDocumentProxy } from 'unpdf'
import { fromBufferPromise } from 'yauzl'
import { getDocumentFormat } from '../../worker/src/upload/documentFormat.ts'
import { MAX_DOCUMENT_TEXT_CHARS } from './document-extractor.mjs'

const MAX_PDF_PAGES = 200
const MAX_ARCHIVE_ENTRIES = 2000
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024
const MAX_WORKSHEETS = 32
const MAX_TABLE_CELLS = 200_000
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const cMapUrl = new URL('./document-assets/cmaps/', import.meta.url).href
const standardFontDataUrl = new URL('./document-assets/standard_fonts/', import.meta.url).href

class PackagedPDFData {
  async fetch({ kind, filename }) {
    const base =
      kind === 'cMapUrl' ? cMapUrl : kind === 'standardFontDataUrl' ? standardFontDataUrl : ''
    if (!base || !/^[A-Za-z0-9_-]+\.(bcmap|pfb|ttf)$/.test(filename)) {
      invalid('文档解析不允许读取外部资源。')
    }
    return new Uint8Array(await readFile(new URL(filename, base)))
  }
}

globalThis.fetch = async () => invalid('文档解析不允许读取外部资源。')

function invalid(message, code = 'DOCUMENT_PARSE_FAILED') {
  throw Object.assign(new Error(message), { code })
}

function limitText(text) {
  if (text.length > MAX_DOCUMENT_TEXT_CHARS)
    invalid('文档文字量超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE')
  return text
}

async function checkArchive(bytes, format) {
  const archive = await fromBufferPromise(bytes, {
    validateEntrySizes: true,
    strictFileNames: true
  })
  let count = 0
  let expanded = 0
  const names = new Set()
  try {
    for await (const entry of archive.eachEntry()) {
      if (entry.isEncrypted()) invalid('文档已加密，请先解密后上传。', 'DOCUMENT_ENCRYPTED')
      expanded += entry.uncompressedSize
      if (++count > MAX_ARCHIVE_ENTRIES || expanded > MAX_EXPANDED_BYTES) {
        invalid('文档解压后超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE')
      }
      names.add(entry.fileName)
    }
  } finally {
    archive.close()
  }
  if (
    !names.has('[Content_Types].xml') ||
    !names.has(format === 'docx' ? 'word/document.xml' : 'xl/workbook.xml')
  ) {
    invalid('文件内容与扩展名不符，请上传有效的 Word 或 Excel 文件。')
  }
}

async function pdfText(bytes) {
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) invalid('文件内容不是有效的 PDF。')
  const pdf = await getDocumentProxy(Uint8Array.from(bytes), {
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    stopAtErrors: true,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    BinaryDataFactory: PackagedPDFData,
    useWasm: false
  })
  try {
    if (pdf.numPages > MAX_PDF_PAGES) invalid('PDF 超过 200 页，请拆分文件。', 'DOCUMENT_TOO_LARGE')
    const sections = []
    let length = 0
    let nonempty = 0
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      const lines = []
      let line = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        line += item.str + (item.hasEOL ? '' : ' ')
        if (item.hasEOL) {
          lines.push(line.trimEnd())
          line = ''
        }
        length += item.str.length + 1
        if (length > MAX_DOCUMENT_TEXT_CHARS)
          invalid('文档文字量超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE')
      }
      if (line) lines.push(line.trimEnd())
      const text = lines.join('\n').trim()
      if (text) nonempty++
      sections.push(`PDF 第 ${index} 页\n${text || '本页没有可提取文字（图片或空白页）。'}`)
      page.cleanup()
    }
    if (!nonempty)
      invalid(
        'PDF 没有可提取文字，可能是扫描件；请先进行 OCR 或上传可复制文字的 PDF。',
        'DOCUMENT_NO_TEXT'
      )
    return limitText(sections.join('\n\n'))
  } finally {
    await pdf.loadingTask.destroy()
  }
}

async function wordText(bytes, format) {
  if (format === 'docx') await checkArchive(bytes, format)
  else if (!bytes.subarray(0, 8).equals(OLE_MAGIC)) invalid('文件内容不是有效的 DOC。')
  const document = await new WordExtractor().extract(bytes)
  const options = { filterUnicode: false }
  const parts = [
    document.getBody(options),
    document.getHeaders({ ...options, includeFooters: false }),
    document.getFooters(options),
    document.getFootnotes(options),
    document.getEndnotes(options),
    document.getTextboxes(options),
    document.getAnnotations(options)
  ].filter((text) => /\S/u.test(text))
  if (!parts.length)
    invalid('Word 文档中没有可提取文字，图片中的文字需要先进行 OCR。', 'DOCUMENT_NO_TEXT')
  return limitText(parts.join('\n\n'))
}

async function spreadsheetText(bytes, format) {
  if (format === 'xlsx') await checkArchive(bytes, format)
  else if (!bytes.subarray(0, 8).equals(OLE_MAGIC)) invalid('文件内容不是有效的 XLS。')
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    cellDates: false,
    cellHTML: false,
    bookVBA: false
  })
  if (workbook.SheetNames.length > MAX_WORKSHEETS)
    invalid('Excel 超过 32 个工作表，请拆分文件。', 'DOCUMENT_TOO_LARGE')
  const sections = []
  let cells = 0
  let length = 0
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    if (!sheet['!ref']) continue
    const range = XLSX.utils.decode_range(sheet['!ref'])
    const rows = range.e.r - range.s.r + 1
    const cols = range.e.c - range.s.c + 1
    cells += rows * cols
    if (rows > 30_000 || cols > 256 || cells > MAX_TABLE_CELLS) {
      invalid('Excel 表格范围超过解析上限，请缩小数据范围或拆分文件。', 'DOCUMENT_TOO_LARGE')
    }
    // Keep formulas with no saved result visible without evaluating or fetching anything.
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!') || !cell.f || cell.v !== undefined) continue
      sheet[address] = { t: 's', v: '=' + cell.f }
    }
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', RS: '\n', blankrows: false })
    if (!/\S/u.test(text)) continue
    const section = `工作表：${name}\n${text}`
    length += section.length + 2
    if (length > MAX_DOCUMENT_TEXT_CHARS)
      invalid('文档文字量超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE')
    sections.push(section)
  }
  if (!sections.length) invalid('Excel 工作簿中没有可提取的单元格内容。', 'DOCUMENT_NO_TEXT')
  return sections.join('\n\n')
}

try {
  const bytes = Buffer.from(workerData.bytes)
  const format = getDocumentFormat(workerData.file)
  if (bytes.subarray(0, 8).equals(OLE_MAGIC)) {
    const compound = XLSX.CFB.read(bytes, { type: 'buffer' })
    const word = XLSX.CFB.find(compound, 'WordDocument')?.content
    if (
      XLSX.CFB.find(compound, 'EncryptedPackage') ||
      (word?.length >= 12 && Buffer.from(word).readUInt16LE(10) & 0x8100)
    ) {
      invalid('文档已加密，请先解密后上传。', 'DOCUMENT_ENCRYPTED')
    }
  }
  const text =
    format === 'pdf'
      ? await pdfText(bytes)
      : format === 'doc' || format === 'docx'
        ? await wordText(bytes, format)
        : format === 'xls' || format === 'xlsx'
          ? await spreadsheetText(bytes, format)
          : invalid('不支持的文档格式。')
  parentPort.postMessage({ text })
} catch (error) {
  const encrypted = error.name === 'PasswordException' || /password|encrypt/i.test(error.message)
  parentPort.postMessage({
    error: {
      code: encrypted
        ? 'DOCUMENT_ENCRYPTED'
        : error.code?.startsWith('DOCUMENT_')
          ? error.code
          : 'DOCUMENT_PARSE_FAILED',
      message: encrypted
        ? '文档已加密，请先解密后上传。'
        : error.code?.startsWith('DOCUMENT_')
          ? error.message
          : '文档解析失败，文件可能损坏或格式不受支持。'
    }
  })
}
