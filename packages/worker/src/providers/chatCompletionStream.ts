import type { ModelRuntimeControl, ModelUsage, SkillStreamChunk } from '../types'
import { logger } from '../infrastructure/logger'
import { parseChatCompletionSSELine } from '../infrastructure/sse'
import { ToolCallAccumulator } from './toolCallAccumulator'

export interface ChatCompletionStreamRequest {
  provider: string
  model: string
  url: string
  apiKey: string
  body: Record<string, unknown>
  timeoutMs?: number
  runtime?: ModelRuntimeControl
  mock?: boolean
}

function estimateInput(messages: unknown): number {
  // Text bytes are conservative; image units remain an explicitly labeled estimate.
  const safe =
    JSON.stringify(messages, (key, value) =>
      key === 'image_url' ? '[image:4096 units]' : value
    ) ?? ''
  const images = (safe.match(/image:4096 units/g) ?? []).length
  return new TextEncoder().encode(safe).length + images * 4096
}

function readCachedInputTokens(
  usage: Record<string, unknown>,
  inputTokens: number
): number | null | undefined {
  const details = usage.prompt_tokens_details
  const nested =
    details && typeof details === 'object'
      ? (details as Record<string, unknown>).cached_tokens
      : undefined
  const values = [nested, usage.prompt_cache_hit_tokens].filter((value) => value !== undefined)
  if (values.length === 0) return undefined
  const cached = values[0]
  if (
    typeof cached !== 'number' ||
    !Number.isSafeInteger(cached) ||
    cached < 0 ||
    cached > inputTokens ||
    values.some((value) => value !== cached)
  )
    return null
  const missed = usage.prompt_cache_miss_tokens
  if (missed !== undefined && (!Number.isSafeInteger(missed) || missed !== inputTokens - cached))
    return null
  return cached
}

export async function* executeChatCompletionStream(
  request: ChatCompletionStreamRequest
): AsyncIterable<SkillStreamChunk> {
  const rawMessages = Array.isArray(request.body.messages) ? request.body.messages : []
  const callId = crypto.randomUUID()
  const estimatedInputTokens =
    estimateInput(rawMessages) + (request.body.tools ? estimateInput(request.body.tools) : 0)
  const requestedOutput = Number(request.body.max_tokens ?? 2048)
  const maxOutputTokens = Number.isFinite(requestedOutput)
    ? Math.min(4096, Math.max(1, Math.floor(requestedOutput)))
    : 2048
  const controller = new AbortController()
  const externalAbort = () => controller.abort(request.runtime?.signal.reason)
  if (request.runtime?.signal.aborted) throw new DOMException('Task cancelled', 'AbortError')
  request.runtime?.signal.addEventListener('abort', externalAbort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('Provider timeout')),
    Math.min(180_000, request.timeoutMs ?? 60_000)
  )
  let started = false
  let output = ''
  let reported:
    | { inputTokens: number; outputTokens: number; cachedInputTokens?: number | null }
    | undefined
  let outcome: ModelUsage['outcome'] = 'unknown'
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const usageFromLine = (line: string) => {
    if (!line.startsWith('data:')) return
    try {
      const usage = JSON.parse(line.slice(5).trim()).usage
      if (
        usage &&
        Number.isSafeInteger(usage.prompt_tokens) &&
        usage.prompt_tokens >= 0 &&
        Number.isSafeInteger(usage.completion_tokens) &&
        usage.completion_tokens >= 0
      ) {
        reported = {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          cachedInputTokens: readCachedInputTokens(usage, usage.prompt_tokens)
        }
      }
    } catch {
      /* Content and [DONE] are handled by the existing SSE parser. */
    }
  }
  try {
    await request.runtime?.beforeCall({
      callId,
      model: request.model,
      estimatedInputTokens,
      maxOutputTokens
    })
    started = true
    if (controller.signal.aborted) throw new DOMException('Task cancelled', 'AbortError')
    logger.info('Calling chat completion provider', {
      provider: request.provider,
      model: request.model,
      messageCount: rawMessages.length,
      callId
    })
    if (request.mock) {
      if (Array.isArray(request.body.tools)) {
        const hasResult = rawMessages.some((message) => message?.role === 'tool')
        const call = hasResult
          ? { id: 'mock-read', name: 'read_file', arguments: { fileId: 'f1', startLine: 1 } }
          : { id: 'mock-search', name: 'search_files', arguments: { query: 'deployment' } }
        output = JSON.stringify(call)
        yield { type: 'tool_call', toolCall: call }
        outcome = 'completed'
        yield { type: 'complete' }
        return
      }
      const text = JSON.stringify(rawMessages)
      const source = text.match(/\[S:(s-[A-Za-z0-9_-]+)\]/)?.[0] ?? ''
      const message =
        '本地模拟结果：这是隔离测试输出，不代表真实模型分析。' +
        (source ? ' 可核对原文 ' + source : '')
      for (const piece of message.match(/.{1,8}/gu) ?? []) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer)
            reject(new DOMException('Task cancelled', 'AbortError'))
          }
          const timer = setTimeout(() => {
            controller.signal.removeEventListener('abort', abort)
            resolve()
          }, 80)
          controller.signal.addEventListener('abort', abort, { once: true })
          if (controller.signal.aborted) abort()
        })
        output += piece
        yield { type: 'content', content: piece }
      }
      outcome = 'completed'
    } else {
      const response = await fetch(request.url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + request.apiKey },
        body: JSON.stringify({ ...request.body, max_tokens: maxOutputTokens }),
        signal: controller.signal
      })
      if (!response.ok) {
        outcome = 'failed'
        // Never echo provider responses: they may contain user content or credentials.
        yield {
          type: 'error',
          error: request.provider.toUpperCase() + ' API Error (Status ' + response.status + ')'
        }
        return
      }
      if (!response.body) {
        outcome = 'failed'
        yield { type: 'error', error: 'Provider response body is empty' }
        return
      }
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let failed = false
      let terminated = false
      let toolFinished = false
      const tools = new ToolCallAccumulator()
      while (true) {
        const { done, value } = await reader.read()
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
        if (buffer.length > 2_000_000) throw new Error('Provider event exceeds size limit')
        const lines = buffer.split('\n')
        buffer = done ? '' : (lines.pop() ?? '')
        for (const line of lines) {
          usageFromLine(line)
          const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : ''
          if (payload === '[DONE]') {
            terminated = true
            continue
          }
          let envelope: {
            error?: unknown
            choices?: Array<{
              finish_reason?: string | null
              delta?: { tool_calls?: unknown; reasoning_content?: unknown }
            }>
          } = {}
          try {
            if (payload) envelope = JSON.parse(payload)
          } catch {
            /* Existing parser ignores malformed records. */
          }
          if (envelope.error) {
            failed = true
            yield { type: 'error', error: 'Provider returned a streaming error' }
            continue
          }
          const delta = envelope.choices?.[0]?.delta
          if (delta?.tool_calls !== undefined) {
            if (!Array.isArray(request.body.tools) || toolFinished)
              throw new Error('Unexpected tool call')
            tools.append(delta.tool_calls)
          }
          if (typeof delta?.reasoning_content === 'string') {
            output += delta.reasoning_content
            if (output.length > 120_000) throw new Error('Provider output exceeds size limit')
            if (Array.isArray(request.body.tools))
              yield { type: 'reasoning', content: delta.reasoning_content }
          }
          const finish = envelope.choices?.[0]?.finish_reason
          if (finish === 'stop') terminated = true
          else if (finish === 'tool_calls' && tools.size > 0) {
            toolFinished = true
            terminated = true
          } else if (finish) {
            failed = true
            yield {
              type: 'error',
              error:
                finish === 'length'
                  ? '模型输出达到上限，仅保留已生成的部分。'
                  : 'Provider could not finish the answer normally'
            }
          }
          const chunk = parseChatCompletionSSELine(line)
          if (!chunk || chunk.type === 'complete') continue
          if (chunk.type === 'content') {
            output += chunk.content ?? ''
            if (output.length > 120_000) throw new Error('Provider output exceeds size limit')
          }
          if (chunk.type === 'error') failed = true
          yield chunk.type === 'error'
            ? { type: 'error', error: 'Provider returned a streaming error' }
            : chunk
        }
        if (done) break
      }
      if (tools.size && (!toolFinished || failed)) {
        failed = true
        yield { type: 'error', error: '工具请求未完整结束，未执行任何工具。' }
      }
      if (tools.size && !failed) {
        const calls = tools.finish()
        output += JSON.stringify(calls)
        for (const toolCall of calls) yield { type: 'tool_call', toolCall }
      }
      outcome = failed ? 'failed' : terminated ? 'completed' : 'unknown'
      if (!failed && !terminated)
        yield { type: 'error', error: '上游连接提前结束，已保留部分回答，请确认后再重试。' }
    }
    if (outcome === 'completed') yield { type: 'complete' }
  } finally {
    clearTimeout(timeout)
    request.runtime?.signal.removeEventListener('abort', externalAbort)
    if (controller.signal.aborted)
      outcome = request.runtime?.signal.aborted ? 'cancelled' : 'unknown'
    controller.abort()
    if (reader) {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    if (started) {
      const usage: ModelUsage = {
        callId,
        model: request.model,
        outcome,
        inputTokens:
          reported?.inputTokens ?? (outcome === 'completed' ? estimatedInputTokens : undefined),
        outputTokens:
          reported?.outputTokens ??
          (outcome === 'completed' ? new TextEncoder().encode(output).length : undefined),
        ...(reported?.cachedInputTokens !== undefined
          ? { cachedInputTokens: reported.cachedInputTokens }
          : {}),
        tokenSource: reported ? 'provider' : outcome === 'completed' ? 'estimated' : 'unknown'
      }
      await request.runtime?.afterCall(usage)
      // Ledger hooks persist usage even when a consumer stops iterating after complete.
      yield { type: 'usage', usage }
    }
  }
}
