import { Worker } from 'node:worker_threads'
import { WorkerError } from '../../worker/src/types/index.ts'

export const MAX_DOCUMENT_TEXT_CHARS = 1_000_000
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

function failure(message, code = 'DOCUMENT_PARSE_FAILED', status = 422) {
  return new WorkerError(message, code, status)
}

function parseInWorker(bytes, file, signal, workerURL, timeoutMs) {
  return new Promise((resolve, reject) => {
    const copy = Uint8Array.from(bytes)
    const worker = new Worker(workerURL, {
      workerData: { bytes: copy, file },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      execArgv: [],
      env: {},
      stdout: true,
      stderr: true
    })
    // Parser diagnostics can contain document data; discard them.
    worker.stdout.resume()
    worker.stderr.resume()
    let settled = false
    const finish = (error, text) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate().then(() => (error ? reject(error) : resolve(text)), reject)
    }
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(
      () => finish(failure('文档解析超时，请拆分文件后重试。', 'DOCUMENT_PARSE_TIMEOUT', 408)),
      timeoutMs
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    worker.on('message', (result) => {
      if (result?.error) {
        finish(
          failure(
            result.error.message,
            result.error.code,
            result.error.code === 'DOCUMENT_TOO_LARGE' ? 413 : 422
          )
        )
      } else if (typeof result?.text !== 'string' || result.text.length > MAX_DOCUMENT_TEXT_CHARS) {
        finish(failure('文档文字量超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE', 413))
      } else {
        finish(null, result.text)
      }
    })
    worker.on('error', (error) =>
      finish(
        error.code === 'ERR_WORKER_OUT_OF_MEMORY'
          ? failure('文档过于复杂，超过解析资源限制，请拆分文件。', 'DOCUMENT_TOO_LARGE', 413)
          : failure('文档解析失败，文件可能损坏或格式不受支持。')
      )
    )
    worker.on('exit', () => {
      if (!settled) finish(failure('文档解析中断，请检查文件后重试。'))
    })
  })
}

/** One isolated parser at a time keeps multi-file tasks within the server's memory budget. */
export function createDocumentExtractor({
  workerURL = new URL('./document-worker.mjs', import.meta.url),
  timeoutMs = 15_000
} = {}) {
  const queue = []
  let active = false
  function drain() {
    if (active || !queue.length) return
    const job = queue.shift()
    job.signal?.removeEventListener('abort', job.cancel)
    if (job.signal?.aborted) {
      job.reject(job.signal.reason)
      drain()
      return
    }
    active = true
    parseInWorker(job.bytes, job.file, job.signal, workerURL, timeoutMs)
      .then(job.resolve, job.reject)
      .finally(() => {
        active = false
        drain()
      })
  }
  return (bytes, file, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_DOCUMENT_BYTES) {
        return reject(failure('文档大小超过解析上限，请拆分文件。', 'DOCUMENT_TOO_LARGE', 413))
      }
      if (queue.length >= 10)
        return reject(failure('文档解析繁忙，请稍后重试。', 'DOCUMENT_PARSE_BUSY', 429))
      const job = { bytes, file, signal, resolve, reject }
      job.cancel = () => {
        const index = queue.indexOf(job)
        if (index < 0) return
        queue.splice(index, 1)
        signal.removeEventListener('abort', job.cancel)
        reject(signal.reason)
      }
      signal?.addEventListener('abort', job.cancel, { once: true })
      queue.push(job)
      drain()
    })
}
