import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelRuntimeControl, ModelUsage, SkillContext, SkillStreamChunk } from '../types'
const logs = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }))
vi.mock('../infrastructure/logger', () => ({ logger: logs }))
import {
  executeChatCompletionStream,
  type ChatCompletionStreamRequest
} from './chatCompletionStream'
import { resolveTextProvider } from './textProvider'
import { resolveQwenMultimodalProviderConfig } from './multimodalProvider'

const encoder = new TextEncoder()
const sensitivePrompt = 'PRIVATE-DOCUMENT-MUST-NOT-BE-LOGGED'
function setup() {
  const abort = new AbortController()
  const beforeCall = vi.fn(
    async (_input: Parameters<ModelRuntimeControl['beforeCall']>[0]) => undefined
  )
  const afterCall = vi.fn(async (_input: ModelUsage) => undefined)
  const runtime: ModelRuntimeControl = { signal: abort.signal, beforeCall, afterCall }
  const request: ChatCompletionStreamRequest = {
    provider: 'bailian',
    model: 'qwen-test',
    url: 'https://upstream.invalid/chat',
    apiKey: 'test-key-never-real',
    body: { messages: [{ role: 'user', content: sensitivePrompt }], stream: true },
    runtime
  }
  return { abort, runtime, beforeCall, afterCall, request }
}
function streamResponse(text: string): Response {
  const bytes = encoder.encode(text)
  let offset = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close()
          return
        }
        // Splits JSON records and multibyte Chinese characters across reads.
        controller.enqueue(bytes.slice(offset, offset + 7))
        offset += 7
      }
    })
  )
}
const contentLine = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'
const usageLine = 'data: {"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":3}}\n\n'
async function collect(request: ChatCompletionStreamRequest): Promise<SkillStreamChunk[]> {
  const chunks: SkillStreamChunk[] = []
  for await (const chunk of executeChatCompletionStream(request)) chunks.push(chunk)
  return chunks
}
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chat completion transport budget and accounting', () => {
  it.each([true, false])(
    'keeps reasoning out of answers while accounting for it (tools=%s)',
    async (withTools) => {
      const { request, afterCall } = setup()
      if (withTools) request.body.tools = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          streamResponse(
            'data: {"choices":[{"delta":{"reasoning_content":"hidden"}}]}\n\n' +
              contentLine +
              'data: [DONE]\n\n'
          )
        )
      )
      const chunks = await collect(request)
      expect(
        chunks
          .filter((chunk) => chunk.type === 'content')
          .map((chunk) => chunk.content)
          .join('')
      ).toBe('你好')
      expect(chunks.filter((chunk) => chunk.type === 'reasoning')).toHaveLength(withTools ? 1 : 0)
      expect(afterCall.mock.calls[0][0]).toMatchObject({
        outputTokens: 12,
        tokenSource: 'estimated'
      })
    }
  )
  it('does not fetch or settle an unstarted call when beforeCall refuses its budget', async () => {
    const { request, beforeCall, afterCall } = setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    beforeCall.mockRejectedValueOnce(new Error('BUDGET_LIMIT'))
    await expect(collect(request)).rejects.toThrow('BUDGET_LIMIT')
    expect(beforeCall).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(afterCall).not.toHaveBeenCalled()
  })
  it('does not reserve or fetch a request whose task signal was already cancelled', async () => {
    const { request, abort, beforeCall, afterCall } = setup()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    abort.abort()
    await expect(collect(request)).rejects.toMatchObject({ name: 'AbortError' })
    expect(beforeCall).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(afterCall).not.toHaveBeenCalled()
  })
  it.each([true, false])(
    'distinguishes reported provider usage from estimates (usage=%s)',
    async (withUsage) => {
      const { request, beforeCall, afterCall } = setup()
      const fetch = vi.fn(async () =>
        streamResponse(contentLine + (withUsage ? usageLine : '') + 'data: [DONE]\n\n')
      )
      vi.stubGlobal('fetch', fetch)
      const chunks = await collect(request)
      expect(
        chunks
          .filter((chunk) => chunk.type === 'content')
          .map((chunk) => chunk.content)
          .join('')
      ).toBe('你好')
      expect(chunks.filter((chunk) => chunk.type === 'complete')).toHaveLength(1)
      expect(afterCall).toHaveBeenCalledTimes(1)
      const usage = afterCall.mock.calls[0][0]
      expect(usage.callId).toBe(beforeCall.mock.calls[0][0].callId)
      expect(usage.outcome).toBe('completed')
      if (withUsage)
        expect(usage).toMatchObject({ inputTokens: 17, outputTokens: 3, tokenSource: 'provider' })
      else
        expect(usage).toMatchObject({
          inputTokens: beforeCall.mock.calls[0][0].estimatedInputTokens,
          outputTokens: 6,
          tokenSource: 'estimated'
        })
      expect(chunks.find((chunk) => chunk.type === 'usage')?.usage).toEqual(usage)
      expect(JSON.stringify(logs.info.mock.calls)).not.toContain(sensitivePrompt)
      expect(JSON.stringify(logs.info.mock.calls)).not.toContain(request.apiKey)
    }
  )
  it('rejects invalid reported counts rather than treating negative usage as free', async () => {
    const { request, afterCall } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(
          contentLine +
            'data: {"usage":{"prompt_tokens":-1,"completion_tokens":0}}\n\ndata: [DONE]\n\n'
        )
      )
    )
    await collect(request)
    expect(afterCall.mock.calls[0][0]).toMatchObject({ tokenSource: 'estimated', outputTokens: 6 })
  })
  it.each([
    [{ prompt_tokens_details: { cached_tokens: 12 } }, 12],
    [{ prompt_cache_hit_tokens: 12, prompt_cache_miss_tokens: 5 }, 12],
    [{ prompt_tokens_details: { cached_tokens: 12 }, prompt_cache_hit_tokens: 12 }, 12],
    [{ prompt_tokens_details: { cached_tokens: 0 } }, 0],
    [{}, undefined],
    [{ prompt_tokens_details: { cached_tokens: 18 } }, null],
    [{ prompt_cache_hit_tokens: -1 }, null],
    [{ prompt_cache_hit_tokens: '12' }, null],
    [{ prompt_cache_hit_tokens: null }, null],
    [{ prompt_tokens_details: { cached_tokens: 12 }, prompt_cache_hit_tokens: 8 }, null],
    [{ prompt_cache_hit_tokens: 12, prompt_cache_miss_tokens: 17 }, null]
  ])(
    'preserves cache usage and flags malformed or conflicting fields (%j)',
    async (cacheFields, expected) => {
      const { request, afterCall } = setup()
      const reportedUsage = { prompt_tokens: 17, completion_tokens: 3, ...cacheFields }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          streamResponse(
            contentLine +
              'data: ' +
              JSON.stringify({ choices: [], usage: reportedUsage }) +
              '\n\ndata: [DONE]\n\n'
          )
        )
      )
      const chunks = await collect(request)
      const recorded = afterCall.mock.calls[0][0]
      expect(recorded).toMatchObject({
        inputTokens: 17,
        outputTokens: 3,
        tokenSource: 'provider',
        outcome: 'completed'
      })
      expect(recorded.cachedInputTokens).toBe(expected)
      expect(chunks.find((chunk) => chunk.type === 'usage')?.usage).toEqual(recorded)
    }
  )
  it('redacts an HTTP error body and records unknown cost-bearing usage', async () => {
    const { request, afterCall } = setup()
    const secretBody = 'UPSTREAM-CREDENTIAL-SECRET-AND-USER-CONTENT'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(secretBody, { status: 429 }))
    )
    const chunks = await collect(request)
    expect(chunks.find((chunk) => chunk.type === 'error')?.error).toContain('429')
    expect(chunks.some((chunk) => chunk.type === 'complete')).toBe(false)
    expect(JSON.stringify(chunks)).not.toContain(secretBody)
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain(secretBody)
    expect(afterCall.mock.calls[0][0]).toMatchObject({
      outcome: 'failed',
      tokenSource: 'unknown',
      inputTokens: undefined,
      outputTokens: undefined
    })
  })
  it('marks an explicit upstream SSE error as failed without leaking provider details', async () => {
    const { request, afterCall } = setup()
    const upstreamSecret = 'PRIVATE-PROVIDER-ERROR-DETAIL'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(
          contentLine +
            `data: {"error":{"message":"${upstreamSecret}","code":"provider_failed"}}\n\n`
        )
      )
    )
    const chunks = await collect(request)
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true)
    expect(chunks.some((chunk) => chunk.type === 'complete')).toBe(false)
    expect(JSON.stringify(chunks)).not.toContain(upstreamSecret)
    expect(afterCall.mock.calls[0][0]).toMatchObject({ outcome: 'failed', tokenSource: 'unknown' })
  })
  it('accounts for a stream read exception as unknown, not a successful zero-token response', async () => {
    const { request, afterCall } = setup()
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          controller.enqueue(encoder.encode(contentLine))
        }
      })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    )
    const generator = executeChatCompletionStream(request)[Symbol.asyncIterator]()
    expect((await generator.next()).value).toMatchObject({ type: 'content', content: '你好' })
    streamController.error(new Error('connection reset'))
    const remaining = async () => {
      while (!(await generator.next()).done) {
        /* Drain usage emitted during finally. */
      }
    }
    await expect(remaining()).rejects.toThrow('connection reset')
    expect(afterCall.mock.calls[0][0]).toMatchObject({
      outcome: 'unknown',
      tokenSource: 'unknown',
      inputTokens: undefined,
      outputTokens: undefined
    })
  })
  it('forwards task abort to fetch and calls cancel on an active reader', async () => {
    const { request, abort, afterCall } = setup()
    let readerCancel!: ReturnType<typeof vi.fn>
    let forwardedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        forwardedSignal = init.signal as AbortSignal
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(contentLine))
            forwardedSignal!.addEventListener(
              'abort',
              () => controller.error(new DOMException('cancelled', 'AbortError')),
              { once: true }
            )
          }
        })
        const getReader = stream.getReader.bind(stream)
        vi.spyOn(stream, 'getReader').mockImplementation(() => {
          const reader = getReader()
          readerCancel = vi.fn(reader.cancel.bind(reader))
          reader.cancel = readerCancel
          return reader
        })
        return new Response(stream)
      })
    )
    const generator = executeChatCompletionStream(request)[Symbol.asyncIterator]()
    expect((await generator.next()).value).toMatchObject({ type: 'content' })
    abort.abort(new Error('user cancellation'))
    const remaining = async () => {
      while (!(await generator.next()).done) {
        /* Drain final accounting event. */
      }
    }
    await expect(remaining()).rejects.toMatchObject({ name: 'AbortError' })
    expect(forwardedSignal?.aborted).toBe(true)
    expect(readerCancel).toHaveBeenCalledTimes(1)
    expect(afterCall.mock.calls[0][0]).toMatchObject({
      outcome: 'cancelled',
      tokenSource: 'unknown'
    })
  })
  it.each([
    [9000, 4096],
    [-5, 1],
    [12.8, 12],
    ['invalid', 2048]
  ])('bounds max_tokens %s to %s for both reservation and fetch', async (requested, expected) => {
    const { request, beforeCall } = setup()
    request.body.max_tokens = requested
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      streamResponse(contentLine + usageLine)
    )
    vi.stubGlobal('fetch', fetch)
    await collect(request)
    expect(beforeCall.mock.calls[0][0].maxOutputTokens).toBe(expected)
    expect(JSON.parse(String(fetch.mock.calls[0][1].body)).max_tokens).toBe(expected)
    expect(fetch.mock.calls[0][1].redirect).toBe('error')
  })
  it('allows mock configuration only in explicitly marked development environments', () => {
    for (const environment of ['development', 'production', undefined]) {
      const context = {
        env: { ENVIRONMENT: environment, MOCK_MODEL: 'true', QWEN_API_KEY: 'fake-only' },
        taskId: 't',
        stepId: 's'
      } as SkillContext
      const input = { messages: [{ role: 'user' as const, content: 'test' }] }
      expect(!!resolveTextProvider(input, context)?.mock).toBe(environment === 'development')
      expect(!!resolveQwenMultimodalProviderConfig(input, context)?.mock).toBe(
        environment === 'development'
      )
    }
  })
})
