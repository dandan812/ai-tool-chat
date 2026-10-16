import type { Env, Message, SkillContext, SkillInput, SkillStreamChunk } from '../types'
import { WorkerError } from '../types'
import { DEFAULT_QWEN_TEXT_MODEL, resolveDefaultTextModel } from '../model/defaultModels'
import { isBailianTextModel } from '../model/textModel'
import { executeChatCompletionStream } from './chatCompletionStream'

export type TextProviderName = 'bailian' | 'compatible'

export interface TextProviderConfig {
  disableThinking?: boolean
  runtime?: SkillContext['env']['RUNTIME_CONTROL']
  mock?: boolean
  maxOutputTokens?: number
  provider: TextProviderName
  model: string
  url: string
  apiKey: string
}

const TEXT_PROVIDER_ENDPOINTS = {
  bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
}

export function hasTextProviderCredentials(
  env: Pick<Env, 'TEXT_API_KEY' | 'TEXT_API_BASE_URL' | 'QWEN_API_KEY'>
): boolean {
  if (env.TEXT_API_KEY || env.TEXT_API_BASE_URL) {
    return !!(env.TEXT_API_KEY?.trim() && env.TEXT_API_BASE_URL?.trim())
  }
  return !!env.QWEN_API_KEY
}

function compatibleEndpoint(baseURL: string): string {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid endpoint')
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + '/chat/completions'
    return url.href
  } catch {
    throw new WorkerError('文本模型接口配置无效，请检查服务地址。', 'MODEL_CONFIG_INVALID', 503)
  }
}

/** Explicit compatible configuration takes precedence and never silently switches providers. */
export function resolveTextProvider(
  input: SkillInput,
  context: SkillContext
): TextProviderConfig | null {
  const requestedModel = typeof input.model === 'string' ? input.model.trim() : ''
  const defaultModel = resolveDefaultTextModel(context.env)

  if (context.env.ENVIRONMENT === 'development' && context.env.MOCK_MODEL === 'true')
    return {
      provider: 'bailian',
      model: requestedModel || defaultModel,
      url: 'https://mock.invalid',
      apiKey: 'local-mock',
      mock: true,
      runtime: context.env.RUNTIME_CONTROL,
      maxOutputTokens: input.maxTokens
    }
  if (context.env.TEXT_API_KEY || context.env.TEXT_API_BASE_URL) {
    if (!hasTextProviderCredentials(context.env)) return null
    return {
      provider: 'compatible',
      model: requestedModel || defaultModel,
      url: compatibleEndpoint(context.env.TEXT_API_BASE_URL!.trim()),
      apiKey: context.env.TEXT_API_KEY!.trim(),
      runtime: context.env.RUNTIME_CONTROL,
      maxOutputTokens: input.maxTokens
    }
  }
  const config =
    resolveRequestedProvider(requestedModel, context) ??
    resolveDefaultProvider(defaultModel, context) ??
    resolveAvailableProviderFallback(context)
  return config
    ? { ...config, runtime: context.env.RUNTIME_CONTROL, maxOutputTokens: input.maxTokens }
    : null
}

function resolveRequestedProvider(model: string, context: SkillContext): TextProviderConfig | null {
  if (isBailianTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', model, context.env.QWEN_API_KEY)
  }

  return null
}

function resolveDefaultProvider(model: string, context: SkillContext): TextProviderConfig | null {
  if (isBailianTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', model, context.env.QWEN_API_KEY)
  }

  return null
}

function resolveAvailableProviderFallback(context: SkillContext): TextProviderConfig | null {
  if (context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', DEFAULT_QWEN_TEXT_MODEL, context.env.QWEN_API_KEY)
  }

  return null
}

function createProviderConfig(
  provider: 'bailian',
  model: string,
  apiKey: string
): TextProviderConfig {
  return {
    provider,
    model,
    url: TEXT_PROVIDER_ENDPOINTS[provider],
    apiKey
  }
}

/**
 * 文本 Skill 不再自己维护一套 fetch + SSE 读取逻辑，
 * 而是直接复用通用的 OpenAI 兼容流式执行器。
 * 这样以后调整日志、超时或流式解析规则时，只需要改一处。
 */
export async function* executeTextProviderStream(
  providerConfig: TextProviderConfig,
  messages: Message[],
  temperature: number
): AsyncIterable<SkillStreamChunk> {
  yield* executeChatCompletionStream({
    provider: providerConfig.provider,
    model: providerConfig.model,
    url: providerConfig.url,
    apiKey: providerConfig.apiKey,
    runtime: providerConfig.runtime,
    mock: providerConfig.mock,
    body: {
      model: providerConfig.model,
      messages,
      stream: true,
      max_tokens: providerConfig.maxOutputTokens ?? 2048,
      stream_options: { include_usage: true },
      temperature,
      ...(providerConfig.disableThinking ? { thinking: { type: 'disabled' } } : {})
    }
  })
}
