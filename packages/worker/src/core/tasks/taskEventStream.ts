import type { TaskRepository } from './taskRepository'

/** Replay durable events and then wait for commits; a slow reader never queues every update. */
export function taskEventStream(
  repository: TaskRepository,
  after: number,
  signal: AbortSignal
): Response {
  const encoder = new TextEncoder()
  let cursor = after
  let changed = true
  let closed = false
  let wake: (() => void) | undefined
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
  const unsubscribe = repository.subscribe(() => {
    changed = true
    wake?.()
  })
  const cleanup = () => {
    if (closed) return
    closed = true
    unsubscribe()
    clearTimeout(heartbeat)
    signal.removeEventListener('abort', abort)
    wake?.()
  }
  const abort = () => {
    cleanup()
    streamController?.close()
  }
  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        streamController = controller
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        else controller.enqueue(encoder.encode(': connected\n\n'))
      },
      async pull(controller) {
        try {
          while (!closed) {
            // Subscribe before reading, and clear the flag before await to avoid missed commits.
            changed = false
            const record = await repository.read()
            if (!record) throw new Error('TASK_NOT_FOUND')
            const page = await repository.events(record, cursor)
            if (closed) return
            if (page.events.length || page.terminal) {
              cursor = page.lastEventId
              controller.enqueue(
                encoder.encode(
                  `event: task-events\nid: ${cursor}\ndata: ${JSON.stringify(page)}\n\n`
                )
              )
              if (page.terminal) {
                cleanup()
                controller.close()
              }
              return
            }
            if (changed) continue
            await new Promise<void>((resolve) => {
              wake = resolve
              heartbeat = setTimeout(resolve, 15000)
            })
            wake = undefined
            clearTimeout(heartbeat)
            if (closed) return
            if (!changed) {
              controller.enqueue(encoder.encode(': heartbeat\n\n'))
              return
            }
          }
        } catch (error) {
          if (!closed) {
            cleanup()
            controller.error(error)
          }
        }
      },
      cancel() {
        cleanup()
      }
    },
    { highWaterMark: 1 }
  )
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no'
    }
  })
}
