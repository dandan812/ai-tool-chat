import { TaskProtocolError } from '../features/tasks/taskProtocol'

// Decode incrementally: both UTF-8 characters and CRLF can cross transport chunks.
export async function* readTaskEventStream(
  body: ReadableStream<Uint8Array>,
  ensureActive: () => void,
  signal?: AbortSignal
): AsyncGenerator<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let line = ''
  let skipLF = false
  let event = ''
  let data: string[] = []
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      ensureActive()
      const { done, value } = await reader.read()
      ensureActive()
      const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
      for (const char of text) {
        if (skipLF && char === '\n') {
          skipLF = false
          continue
        }
        skipLF = char === '\r'
        if (char !== '\r' && char !== '\n') {
          line += char
          continue
        }
        if (!line) {
          if (event === 'task-events' && data.length) {
            let page: unknown
            try {
              page = JSON.parse(data.join('\n'))
            } catch {
              throw new TaskProtocolError()
            }
            yield page
          }
          event = ''
          data = []
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') event = value
          if (field === 'data') data.push(value)
        }
        line = ''
      }
      // An unterminated frame is replayed from the last committed cursor on reconnect.
      if (done) return
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
