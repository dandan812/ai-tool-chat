import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createRuntime } from '../dist/runtime.mjs'
import {
  pdfDocument,
  docDocument,
  docxDocument,
  spreadsheetDocument
} from './fixtures/documents.mjs'

const origin = 'http://127.0.0.1'
const originalFetch = globalThis.fetch
before(() => {
  globalThis.fetch = async () =>
    assert.fail('Document workflow tests must not contact a model or external service')
})
after(() => {
  globalThis.fetch = originalFetch
})

function call(runtime, path, cookie, body) {
  return runtime.fetch(
    new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(!(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        'Idempotency-Key': randomUUID()
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
    })
  )
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ait-document-test-'))
  const runtime = await createRuntime({
    dataDirectory: directory,
    pollMs: 10,
    variables: {
      ENVIRONMENT: 'development',
      ALLOW_REGISTRATION: 'true',
      MOCK_MODEL: 'true',
      ALLOWED_ORIGINS: origin
    }
  })
  t.after(async () => {
    await runtime.close()
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('ait-document-test-'))
    await rm(directory, { recursive: true, force: true })
  })
  const response = await call(runtime, '/auth/register', undefined, {
    username: 'document-tester',
    password: 'Synthetic-Documents-2026!'
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.getSetCookie()[0].split(';')[0]
  return { runtime, cookie }
}

async function upload(runtime, cookie, bytes, fileName, mimeType = '') {
  const fileId = randomUUID()
  const fileHash = createHash('md5').update(bytes).digest('hex')
  const split = Math.ceil(bytes.length / 2)
  for (let index = 0; index < 2; index++) {
    const form = new FormData()
    for (const [key, value] of Object.entries({
      fileId,
      fileName,
      mimeType,
      fileHash,
      fileSize: String(bytes.length),
      totalChunks: '2',
      chunkIndex: String(index)
    }))
      form.set(key, value)
    form.set(
      'chunk',
      new File([bytes.subarray(index * split, (index + 1) * split)], fileName, { type: mimeType })
    )
    const response = await call(runtime, '/upload/chunk', cookie, form)
    assert.equal(response.status, 200)
  }
  const completed = await call(runtime, '/upload/complete', cookie, { fileId })
  assert.equal(completed.status, 200)
  const file = (await completed.json()).file
  assert.equal(file.fileHash, fileHash)
  assert.equal(file.fileName, fileName)
  return file
}

async function runTask(runtime, cookie, file, options = {}) {
  const created = await call(runtime, '/tasks', cookie, {
    messages: [{ role: 'user', content: '请总结资料并提供原文引用。' }],
    files: [file],
    ...options
  })
  assert.equal(created.status, 202)
  const id = (await created.json()).task.id
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const response = await call(runtime, '/tasks/' + id, cookie)
    assert.equal(response.status, 200)
    const { task } = await response.json()
    if (!['pending', 'running'].includes(task.status)) return task
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error('Synthetic document task did not finish')
}

test('file agent persists three model calls, tool steps, citations and replayable SSE on SQLite', async (t) => {
  const { runtime, cookie } = await setup(t)
  const file = await upload(
    runtime,
    cookie,
    Buffer.from('deployment region: Tokyo.\n交付日期：十月十五日。'),
    'research.txt'
  )
  const task = await runTask(runtime, cookie, file, { enableTools: true })
  assert.equal(task.status, 'completed', task.error)
  assert.equal(task.metadata.metrics.modelCalls, 3)
  assert.equal(task.metadata.toolingMode, 'active')
  assert.equal(
    task.steps.filter((step) => step.type === 'mcp' && step.status === 'completed').length,
    2
  )
  assert.ok(task.metadata.sources.some((source) => task.result.includes(`[S:${source.sourceId}]`)))
  const response = await runtime.fetch(
    new Request(origin + '/tasks/' + task.id + '/events?after=0', {
      headers: { Cookie: cookie, Origin: origin, Accept: 'text/event-stream' }
    })
  )
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /text\/event-stream/)
  const frames = await response.text()
  assert.match(frames, /搜索资料/)
  assert.match(frames, /读取原文/)
  assert.match(frames, /"terminal":true/)
  const snapshot = (await (await call(runtime, '/tasks/' + task.id, cookie)).json()).task
  assert.equal(snapshot.metadata.metrics.modelCalls, 3)
  assert.deepEqual(snapshot.metadata.sources, task.metadata.sources)
})

test('five document formats complete chunk upload, parsing and persistent evidence on the actual Node runtime', async (t) => {
  const { runtime, cookie } = await setup(t)
  const documents = [
    ['contract.pdf', pdfDocument(), 'delivery in 15 days'],
    ['contract.doc', docDocument('合同交付期限：十五日。'), '合同交付期限：十五日'],
    ['contract.docx', docxDocument('合同交付期限：十五日。'), '合同交付期限：十五日'],
    ['budget.xls', spreadsheetDocument('xls'), '负责人\t林青'],
    ['budget.xlsx', spreadsheetDocument('xlsx'), '负责人\t林青'],
    ['notes.txt', Buffer.from('原文本仍可分析。\r\n验证旧上传链路。'), '原文本仍可分析']
  ]
  for (const [name, bytes, expected, mime] of documents) {
    const file = await upload(runtime, cookie, bytes, name, mime)
    const task = await runTask(runtime, cookie, file)
    assert.equal(task.status, 'completed', name + ': ' + task.error)
    const sources = task.metadata.sources
    assert.ok(sources.length > 0, name)
    assert.ok(
      sources.some((source) => source.excerpt.includes(expected)),
      name
    )
    for (const source of sources) {
      assert.equal(source.fileName, name)
      assert.equal(source.fileHash, createHash('sha256').update(bytes).digest('hex'))
      assert.ok(source.startLine > 0)
      assert.ok(source.endOffset > source.startOffset)
    }
    const persisted = (await (await call(runtime, '/tasks/' + task.id, cookie)).json()).task
    assert.deepEqual(persisted.metadata.sources, sources)
  }
})

test('CSV reported by the browser as Excel keeps text parsing and persistent evidence', async (t) => {
  const { runtime, cookie } = await setup(t)
  const bytes = Buffer.from('负责人,林青\r\n交付期限,十五日')
  const file = await upload(runtime, cookie, bytes, 'budget.csv', 'application/vnd.ms-excel')
  const task = await runTask(runtime, cookie, file)
  assert.equal(task.status, 'completed', task.error)
  assert.ok(task.metadata.sources.some((source) => source.excerpt.includes('负责人,林青')))
  const persisted = (await (await call(runtime, '/tasks/' + task.id, cookie)).json()).task
  assert.deepEqual(persisted.metadata.sources, task.metadata.sources)
})

test('scan-only and corrupt documents produce persisted actionable errors before any model call', async (t) => {
  const { runtime, cookie } = await setup(t)
  for (const [name, bytes, message] of [
    ['scan.pdf', pdfDocument(['']), 'OCR'],
    ['broken.docx', Buffer.from('invalid docx binary'), '文档解析失败']
  ]) {
    const file = await upload(runtime, cookie, bytes, name)
    const task = await runTask(runtime, cookie, file)
    assert.equal(task.status, 'failed')
    assert.ok(task.error.includes(message), task.error)
    assert.equal(task.metadata.metrics.modelCalls, 0)
    assert.deepEqual(task.metadata.sources ?? [], [])
  }
})
