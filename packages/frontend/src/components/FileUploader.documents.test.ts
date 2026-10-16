import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FileUploader from './FileUploader.vue'
import { uploadChunkedFile } from '../utils/chunk'
import type { UploadedFileRef, UploadProgress } from '../types/task'

vi.mock('../utils/chunk', () => ({ uploadChunkedFile: vi.fn() }))

let app: App | undefined

function uploaded(file: File): UploadedFileRef {
  return {
    fileId: file.name,
    fileHash: 'binary-hash',
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    source: 'uploaded'
  }
}

function progress(file: File): UploadProgress {
  return {
    fileId: file.name,
    fileName: file.name,
    percentage: 50,
    uploadedChunks: 1,
    totalChunks: 2,
    speed: 1,
    estimatedTime: 1
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

async function settle() {
  await nextTick()
  await nextTick()
  await nextTick()
}

async function mountUploader(disabled = false) {
  const props = ref({ files: [] as UploadedFileRef[], disabled })
  const uploader = ref<{ open: () => void; addFiles: (files: File[]) => Promise<void> }>()
  const add = vi.fn()
  const error = vi.fn()
  const busy = vi.fn()
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    setup: () => () =>
      h(FileUploader, {
        ...props.value,
        ref: uploader,
        onAdd: add,
        onUploadError: error,
        onBusy: busy
      })
  })
  app.mount(root)
  await settle()
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!
  return { root, input, props, uploader, add, error, busy }
}

function select(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  vi.mocked(uploadChunkedFile).mockReset()
  vi.mocked(uploadChunkedFile).mockImplementation(async (file) => uploaded(file))
})

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

describe('document file selection', () => {
  it.each([
    ['report.pdf', 'application/pdf'],
    ['REPORT.DOC', ''],
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['REPORT.XLS', ''],
    ['REPORT.XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['table.csv', 'text/csv'],
    ['notes.txt', 'text/plain'],
    ['source.TS', ''],
    ['source.svg', 'image/svg+xml'],
    ['SOURCE.SVG', 'image/svg+xml']
  ])('passes the original %s File to the chunk uploader', async (name, type) => {
    const { input, add, busy } = await mountUploader()
    const file = new File([new Uint8Array([0, 255, 128, 10])], name, { type })
    select(input, [file])
    await settle()
    expect(vi.mocked(uploadChunkedFile).mock.calls[0]![0]).toBe(file)
    expect(add).toHaveBeenCalledExactlyOnceWith(uploaded(file))
    expect(busy.mock.calls).toEqual([[true], [false]])
    expect(input.value).toBe('')
    expect(input.disabled).toBe(false)
  })

  it('exposes picker filters for documents, text and code', async () => {
    const { input } = await mountUploader()
    const accept = input.accept.split(',')
    for (const type of ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.ts', '.py']) {
      expect(accept).toContain(type)
    }
    expect(accept).toContain('text/plain')
    expect(accept).toContain('application/pdf')
  })

  it.each([
    ['REPORT.XLSX', ''],
    ['SOURCE.SVG', 'image/svg+xml']
  ])('uses the same file handling for dragged %s', async (name, type) => {
    const { root, add } = await mountUploader()
    const file = new File([new Uint8Array([0, 255])], name, { type })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
    root.querySelector('.upload-zone')!.dispatchEvent(event)
    await settle()
    expect(event.defaultPrevented).toBe(true)
    expect(vi.mocked(uploadChunkedFile).mock.calls[0]![0]).toBe(file)
    expect(add).toHaveBeenCalledExactlyOnceWith(uploaded(file))
  })

  it.each([
    ['program.exe', 'application/octet-stream'],
    ['figure.png', 'image/png'],
    ['figure.docx', 'image/png']
  ])('reports %s without uploading it as a document', async (name, type) => {
    const { root, input, add, error } = await mountUploader()
    select(input, [new File(['content'], name, { type })])
    await settle()
    expect(uploadChunkedFile).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledExactlyOnceWith(`不支持的文件类型：${name}`)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(name)
  })

  it('blocks selection, drops and exposed upload calls while disabled', async () => {
    const { root, input, uploader } = await mountUploader(true)
    const file = new File(['document'], 'report.pdf', { type: 'application/pdf' })
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    select(input, [file])
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } })
    root.querySelector('.upload-zone')!.dispatchEvent(event)
    await uploader.value!.addFiles([file])
    uploader.value!.open()
    await settle()
    expect(input.disabled).toBe(true)
    expect(click).not.toHaveBeenCalled()
    expect(uploadChunkedFile).not.toHaveBeenCalled()
  })

  it('preserves a mixed batch error when successful additions clear the parent error', async () => {
    const { uploader, add, error } = await mountUploader()
    let displayedError = ''
    error.mockImplementation((message: string) => {
      displayedError = message
    })
    add.mockImplementation(() => {
      displayedError = ''
    })
    const file = new File(['document'], 'report.pdf')
    await uploader.value!.addFiles([new File(['binary'], 'program.exe'), file])
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledExactlyOnceWith(uploaded(file))
    expect(displayedError).toBe('不支持的文件类型：program.exe')
  })

  it('blocks reentry before progress arrives and stops a batch if disabled during upload', async () => {
    const operation = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile).mockReturnValueOnce(operation.promise)
    const { input, props, uploader, add, busy } = await mountUploader()
    const file = new File(['first'], 'report.pdf')
    const second = new File(['second'], 'table.xlsx')
    const first = uploader.value!.addFiles([file, second])
    await settle()
    expect(input.disabled).toBe(true)
    await uploader.value!.addFiles([second])
    select(input, [second])
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    props.value.disabled = true
    await settle()
    operation.resolve(uploaded(file))
    await first
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(add).toHaveBeenCalledExactlyOnceWith(uploaded(file))
    expect(busy.mock.calls).toEqual([[true], [false]])
  })

  it('shows upload errors, removes failed progress and clears the error on retry', async () => {
    const operation = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile).mockReturnValueOnce(operation.promise)
    const { root, input, error, add } = await mountUploader()
    const file = new File(['document'], 'report.docx')
    select(input, [file])
    vi.mocked(uploadChunkedFile).mock.calls[0]![1]!.onProgress!(progress(file))
    await settle()
    expect(root.querySelector('progress')).not.toBeNull()
    operation.reject(new Error('Document upload interrupted'))
    await settle()
    expect(error).toHaveBeenCalledExactlyOnceWith('Document upload interrupted')
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Document upload interrupted')
    expect(root.querySelector('progress')).toBeNull()
    expect(input.disabled).toBe(false)
    select(input, [file])
    await settle()
    expect(root.querySelector('[role="alert"]')).toBeNull()
    expect(add).toHaveBeenCalledExactlyOnceWith(uploaded(file))
  })
})
