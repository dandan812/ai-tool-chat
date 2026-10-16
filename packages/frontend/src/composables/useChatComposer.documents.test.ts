import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatComposer } from './useChatComposer'
import { uploadChunkedFile } from '../utils/chunk'
import { saveDraftImage } from '../utils/draftImageStore'
import type { UploadedFileRef, UploadProgress } from '../types/task'

vi.mock('../utils/chunk', () => ({ uploadChunkedFile: vi.fn() }))
vi.mock('../utils/draftImageStore', () => ({
  clearDraftImages: vi.fn(async () => {}),
  loadDraftImages: vi.fn(async () => []),
  revokeDraftPreviews: vi.fn(),
  syncDraftImageRefs: vi.fn(),
  removeDraftImage: vi.fn(),
  resolveDraftImage: vi.fn(),
  saveDraftImage: vi.fn()
}))

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

function clipboard(files: File[]): ClipboardEvent {
  return {
    clipboardData: {
      items: files.map((file) => ({ type: file.type, getAsFile: () => file }))
    }
  } as unknown as ClipboardEvent
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

async function mountComposer() {
  let composer!: ReturnType<typeof useChatComposer>
  const loading = ref(false)
  const uploadBusy = ref(false)
  const sessionId = ref('first')
  const send = vi.fn()
  app = createApp({
    setup() {
      composer = useChatComposer({ loading, uploadBusy, sessionId, onSend: send })
      return () => null
    }
  })
  app.mount(document.createElement('div'))
  await nextTick()
  return { composer, loading, uploadBusy, sessionId, send }
}

beforeEach(() => {
  vi.mocked(uploadChunkedFile).mockReset()
  vi.mocked(uploadChunkedFile).mockImplementation(async (file) => uploaded(file))
  vi.mocked(saveDraftImage).mockReset()
  vi.mocked(saveDraftImage).mockImplementation(async (file) => ({
    id: file.name,
    draftKey: file.name,
    previewUrl: `blob:${file.name}`,
    mimeType: file.type
  }))
})

afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

describe('pasted document attachments', () => {
  it.each([
    ['report.pdf', 'application/pdf'],
    ['REPORT.PDF', ''],
    ['report.doc', 'application/msword'],
    ['REPORT.DOC', ''],
    ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['REPORT.DOCX', ''],
    ['report.xls', 'application/vnd.ms-excel'],
    ['REPORT.XLS', ''],
    ['report.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['REPORT.XLSX', ''],
    ['table.csv', 'text/csv'],
    ['notes.txt', 'text/plain'],
    ['source.PY', '']
  ])(
    'uploads pasted %s unchanged and sends the existing file reference shape',
    async (name, type) => {
      const { composer, send } = await mountComposer()
      const file = new File([new Uint8Array([0, 255, 128, 10])], name, { type })
      await composer.handlePaste(clipboard([file]))
      expect(vi.mocked(uploadChunkedFile).mock.calls[0]![0]).toBe(file)
      expect(saveDraftImage).not.toHaveBeenCalled()
      expect(composer.files.value).toEqual([uploaded(file)])
      expect(composer.hasPendingUploads.value).toBe(false)
      await composer.sendMessage()
      expect(send).toHaveBeenCalledExactlyOnceWith('', [], [uploaded(file)])
    }
  )

  it('routes pasted images through draft image storage without a document upload', async () => {
    const { composer } = await mountComposer()
    const png = new File(['pixels'], 'figure.png', { type: 'image/png' })
    const svg = new File(['<svg/>'], 'figure.svg', { type: 'image/svg+xml' })
    const file = new File(['document'], 'report.pdf')
    await composer.handlePaste(clipboard([png, svg, file]))
    expect(vi.mocked(saveDraftImage).mock.calls.map(([image]) => image)).toEqual([png, svg])
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(vi.mocked(uploadChunkedFile).mock.calls[0]![0]).toBe(file)
    expect(composer.images.value).toHaveLength(2)
    expect(composer.files.value).toEqual([uploaded(file)])
  })

  it('reports unsupported pasted files without uploading', async () => {
    const { composer } = await mountComposer()
    await composer.handlePaste(
      clipboard([new File(['binary'], 'program.exe', { type: 'application/octet-stream' })])
    )
    expect(uploadChunkedFile).not.toHaveBeenCalled()
    expect(composer.uploadError.value).toContain('不支持的文件类型：program.exe')
    expect(composer.statusTone.value).toBe('is-error')
    expect(composer.hasPendingUploads.value).toBe(false)
  })

  it('keeps a mixed batch error visible while retaining its valid document', async () => {
    const { composer } = await mountComposer()
    const file = new File(['document'], 'report.pdf')
    await composer.handlePaste(clipboard([new File(['binary'], 'program.exe'), file]))
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(composer.files.value).toEqual([uploaded(file)])
    expect(composer.statusText.value).toBe('不支持的文件类型：program.exe')
    expect(composer.statusTone.value).toBe('is-error')
    expect(composer.hasPendingUploads.value).toBe(false)
  })

  it.each(['loading', 'uploadBusy', 'imageBusy', 'progressBusy'])(
    'blocks paste while %s',
    async (state) => {
      const { composer, loading, uploadBusy } = await mountComposer()
      if (state === 'loading') loading.value = true
      if (state === 'uploadBusy') uploadBusy.value = true
      if (state === 'imageBusy') {
        const image = deferred<Awaited<ReturnType<typeof saveDraftImage>>>()
        vi.mocked(saveDraftImage).mockReturnValueOnce(image.promise)
        const adding = composer.addImage(
          new File(['pixels'], 'existing.png', { type: 'image/png' })
        )
        await composer.handlePaste(clipboard([new File(['document'], 'report.pdf')]))
        expect(uploadChunkedFile).not.toHaveBeenCalled()
        image.resolve({
          id: 'existing',
          draftKey: 'key',
          previewUrl: 'blob:existing',
          mimeType: 'image/png'
        })
        await adding
        return
      }
      if (state === 'progressBusy') {
        composer.handleUploadProgress(progress(new File(['existing'], 'existing.txt')))
      }
      const file = new File(['document'], 'report.pdf')
      const image = new File(['pixels'], 'figure.png', { type: 'image/png' })
      await composer.handlePaste(clipboard([file, image]))
      expect(uploadChunkedFile).not.toHaveBeenCalled()
      expect(saveDraftImage).not.toHaveBeenCalled()
    }
  )

  it('blocks sending and a second paste before progress arrives and throughout a batch', async () => {
    const first = deferred<UploadedFileRef>()
    const second = deferred<UploadedFileRef>()
    const secondStarted = deferred<void>()
    vi.mocked(uploadChunkedFile)
      .mockReturnValueOnce(first.promise)
      .mockImplementationOnce(() => {
        secondStarted.resolve()
        return second.promise
      })
    const { composer, send } = await mountComposer()
    const pdf = new File(['first'], 'report.pdf')
    const xlsx = new File(['second'], 'table.xlsx')
    const operation = composer.handlePaste(clipboard([pdf, xlsx]))
    await nextTick()
    expect(composer.hasPendingUploads.value).toBe(true)
    expect(composer.canSend.value).toBe(false)
    await composer.handlePaste(clipboard([new File(['extra'], 'extra.docx')]))
    await composer.sendMessage()
    expect(uploadChunkedFile).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    first.resolve(uploaded(pdf))
    await secondStarted.promise
    expect(uploadChunkedFile).toHaveBeenCalledTimes(2)
    expect(composer.files.value).toEqual([uploaded(pdf)])
    expect(composer.canSend.value).toBe(false)
    second.resolve(uploaded(xlsx))
    await operation
    expect(composer.hasPendingUploads.value).toBe(false)
    expect(composer.canSend.value).toBe(true)
    expect(composer.files.value).toEqual([uploaded(pdf), uploaded(xlsx)])
  })

  it('clears failed progress, reports the error and permits a retry', async () => {
    const failure = deferred<UploadedFileRef>()
    vi.mocked(uploadChunkedFile).mockReturnValueOnce(failure.promise)
    const { composer } = await mountComposer()
    const file = new File(['document'], 'report.docx')
    const operation = composer.handlePaste(clipboard([file]))
    await nextTick()
    vi.mocked(uploadChunkedFile).mock.calls[0]![1]!.onProgress!(progress(file))
    expect(composer.pendingUploadList.value).toHaveLength(1)
    failure.reject(new Error('Document upload interrupted'))
    await operation
    expect(composer.pendingUploadList.value).toEqual([])
    expect(composer.hasPendingUploads.value).toBe(false)
    expect(composer.statusText.value).toBe('Document upload interrupted')
    await composer.handlePaste(clipboard([file]))
    expect(composer.files.value).toEqual([uploaded(file)])
    expect(composer.uploadError.value).toBe('')
    expect(composer.canSend.value).toBe(true)
  })

  it.each(['session', 'clear', 'unmount'])(
    'ignores late document progress and results after %s',
    async (action) => {
      const pending = deferred<UploadedFileRef>()
      vi.mocked(uploadChunkedFile).mockReturnValueOnce(pending.promise)
      const { composer, sessionId } = await mountComposer()
      const file = new File(['document'], 'report.pdf')
      const operation = composer.handlePaste(clipboard([file, new File(['second'], 'second.xlsx')]))
      await nextTick()
      const onProgress = vi.mocked(uploadChunkedFile).mock.calls[0]![1]!.onProgress!
      if (action === 'session') {
        sessionId.value = 'second'
        await nextTick()
      }
      if (action === 'clear') await composer.clearComposer()
      if (action === 'unmount') {
        app!.unmount()
        app = undefined
      }
      onProgress(progress(file))
      pending.resolve(uploaded(file))
      await operation
      expect(uploadChunkedFile).toHaveBeenCalledOnce()
      expect(composer.files.value).toEqual([])
      expect(composer.pendingUploadList.value).toEqual([])
      expect(composer.uploadError.value).toBe('')
    }
  )
})
