import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocumentExtractor } from '../dist/document-extractor.mjs'
import * as XLSX from 'xlsx'
import {
  pdfDocument,
  docDocument,
  docxDocument,
  spreadsheetDocument,
  zipDocument
} from './fixtures/documents.mjs'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const extract = createDocumentExtractor({
  workerURL: new URL('../dist/document-worker.mjs', import.meta.url)
})
const ref = (extension, mimeType = '') => ({
  fileId: 'synthetic',
  fileName: 'synthetic.' + extension,
  mimeType,
  size: 1,
  fileHash: 'synthetic',
  source: 'uploaded'
})

test('built PDF parser extracts each page and preserves page boundaries', async () => {
  const text = await extract(
    pdfDocument(['First: delivery in 15 days.', 'Second: price is 1234.50.']),
    ref('pdf')
  )
  assert.match(text, /PDF 第 1 页\nFirst: delivery in 15 days/)
  assert.match(text, /PDF 第 2 页\nSecond: price is 1234.50/)
})

test('Chinese PDF text uses packaged CMaps without system fonts or network requests', async () => {
  const text = await extract(pdfDocument(['合同交付期限：十五日。'], false, true), ref('pdf'))
  assert.match(text, /合同交付期限：十五日。/)
})
test('DOC and DOCX parse real binary containers, Unicode paragraphs and headers', async () => {
  const body = '合同交付期限：十五日。\n负责人：“林青”。'
  const legacy = await extract(docDocument(body), ref('doc'))
  assert.match(legacy, /合同交付期限：十五日/)
  assert.match(legacy, /负责人：“林青”/)
  const modern = await extract(docxDocument(body), ref('DOCX'))
  assert.match(modern, /合同交付期限：十五日。\n负责人：“林青”/)
  assert.match(modern, /Synthetic header/)
})

for (const type of ['xls', 'xlsx']) {
  test(type + ' extracts multiple sheets, numeric values and Chinese cell text', async () => {
    const text = await extract(spreadsheetDocument(type), ref(type))
    assert.match(text, /工作表：Revenue/)
    assert.match(text, /Widget\t1234.5/)
    assert.match(text, /工作表：Notes/)
    assert.match(text, /负责人\t林青/)
    assert.match(text, /交付期限\t十五日/)
  })
}

test('formulas use saved results and unsaved formulas remain visible without evaluation', async () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    {
      A1: { t: 'n', v: 3, f: 'SUM(1,2)' },
      A2: { t: 'n', f: 'SUM(2,3)' },
      '!ref': 'A1:A2'
    },
    'Formulas'
  )
  const text = await extract(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), ref('xlsx'))
  assert.match(text, /\n3\n/)
  assert.match(text, /=SUM\(2,3\)/)
})

test('scan-only/blank PDFs and empty spreadsheets return actionable errors', async () => {
  await assert.rejects(extract(pdfDocument(['']), ref('pdf')), { code: 'DOCUMENT_NO_TEXT' })
  await assert.rejects(extract(spreadsheetDocument('xlsx', { Empty: [] }), ref('xlsx')), {
    code: 'DOCUMENT_NO_TEXT'
  })
})

test('encrypted PDF and DOC are rejected before producing evidence', async () => {
  await assert.rejects(extract(pdfDocument(['Hidden'], true), ref('pdf')), {
    code: 'DOCUMENT_ENCRYPTED'
  })
  await assert.rejects(extract(docDocument('Secret', true), ref('doc')), {
    code: 'DOCUMENT_ENCRYPTED'
  })
})

test('corrupt data, renamed containers and unsupported formats never become binary text', async () => {
  for (const type of ['pdf', 'doc', 'docx', 'xls', 'xlsx']) {
    await assert.rejects(extract(Buffer.from('not a valid binary document'), ref(type)), {
      code: 'DOCUMENT_PARSE_FAILED'
    })
  }
  await assert.rejects(extract(spreadsheetDocument('xlsx'), ref('docx')), {
    code: 'DOCUMENT_PARSE_FAILED'
  })
  await assert.rejects(extract(docxDocument(), ref('xlsx')), { code: 'DOCUMENT_PARSE_FAILED' })
})

test('document page, decompression, output and worksheet range limits reject instead of truncating', async () => {
  await assert.rejects(extract(pdfDocument(Array(201).fill('Page')), ref('pdf')), {
    code: 'DOCUMENT_TOO_LARGE'
  })
  await assert.rejects(extract(docxDocument('x'.repeat(1_000_001)), ref('docx')), {
    code: 'DOCUMENT_TOO_LARGE'
  })
  const oversized = zipDocument({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': 'x'.repeat(65 * 1024 * 1024)
  })
  await assert.rejects(extract(oversized, ref('docx')), { code: 'DOCUMENT_TOO_LARGE' })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    { A1: { t: 's', v: 'start' }, A30001: { t: 's', v: 'end' }, '!ref': 'A1:A30001' },
    'TooManyRows'
  )
  await assert.rejects(
    extract(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), ref('xlsx')),
    { code: 'DOCUMENT_TOO_LARGE' }
  )
})

test('parser timeout terminates the worker and the queue remains usable', async () => {
  const slow = createDocumentExtractor({
    workerURL: new URL('./fixtures/waiting-parser.mjs', import.meta.url),
    timeoutMs: 250
  })
  const first = slow(Buffer.from('hang'), ref('pdf'))
  const second = slow(Buffer.from('ok'), ref('pdf'))
  await assert.rejects(first, { code: 'DOCUMENT_PARSE_TIMEOUT' })
  assert.equal(await second, 'Synthetic result')
})

test('active and queued cancellation releases resources without blocking the next document', async () => {
  const isolated = createDocumentExtractor({
    workerURL: new URL('./fixtures/waiting-parser.mjs', import.meta.url)
  })
  const active = new AbortController()
  const queued = new AbortController()
  const first = isolated(Buffer.from('hang'), ref('pdf'), active.signal)
  const second = isolated(Buffer.from('ok'), ref('pdf'), queued.signal)
  const next = isolated(Buffer.from('ok'), ref('pdf'))
  const activeCancelled = assert.rejects(first, /Active cancellation/)
  const queuedCancelled = assert.rejects(second, /Queued cancellation/)
  queued.abort(new Error('Queued cancellation'))
  active.abort(new Error('Active cancellation'))
  await Promise.all([activeCancelled, queuedCancelled])
  assert.equal(await next, 'Synthetic result')
})

test('parser workers discard parent CLI flags and protected environment files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ait-document-flags-'))
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('ait-document-flags-'))
    await rm(directory, { recursive: true, force: true })
  })
  const environmentFile = join(directory, 'synthetic.env')
  await writeFile(environmentFile, 'DOC_PARSER_SHOULD_NOT_INHERIT=synthetic-secret\n', {
    mode: 0o600
  })
  const moduleURL = new URL('../dist/document-extractor.mjs', import.meta.url).href
  const fixtureURL = new URL('./fixtures/waiting-parser.mjs', import.meta.url).href
  const source = `
    import assert from 'node:assert/strict';
    import { createDocumentExtractor } from ${JSON.stringify(moduleURL)};
    assert.equal(process.env.DOC_PARSER_SHOULD_NOT_INHERIT, 'synthetic-secret');
    const extract = createDocumentExtractor({ workerURL: new URL(${JSON.stringify(fixtureURL)}) });
    assert.equal(await extract(Buffer.from('ok'), { fileName: 'synthetic.pdf' }), 'Synthetic result');
    console.log('Isolated parser passed');
  `
  const { stdout } = await promisify(execFile)(process.execPath, [
    '--env-file=' + environmentFile,
    '--input-type=module',
    '-e',
    source
  ])
  assert.match(stdout, /Isolated parser passed/)
})

test('release parser and Chinese font assets work outside the repository without node_modules', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ait-document-bundle-'))
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('ait-document-bundle-'))
    await rm(directory, { recursive: true, force: true })
  })
  for (const file of ['document-extractor.mjs', 'document-worker.mjs', 'document-assets']) {
    await cp(new URL('../dist/' + file, import.meta.url), join(directory, file), {
      recursive: true
    })
  }
  const { createDocumentExtractor: bundledExtractor } = await import(
    pathToFileURL(join(directory, 'document-extractor.mjs'))
  )
  const standalone = bundledExtractor()
  const chinese = await standalone(pdfDocument(['合同交付期限：十五日。'], false, true), ref('pdf'))
  assert.match(chinese, /合同交付期限：十五日/)
  assert.match(await standalone(docDocument('Legacy Word text'), ref('doc')), /Legacy Word text/)
  assert.match(await standalone(docxDocument('Modern Word text'), ref('docx')), /Modern Word text/)
  for (const format of ['xls', 'xlsx']) {
    assert.match(await standalone(spreadsheetDocument(format), ref(format)), /负责人\t林青/)
  }
})
