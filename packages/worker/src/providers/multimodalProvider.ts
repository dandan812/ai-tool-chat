import type { ImageData, Message, SkillContext, SkillInput, SkillStreamChunk } from '../types'
import { resolveMultimodalModel } from '../model/defaultModels'
import { executeChatCompletionStream } from './chatCompletionStream'
import { hasTextProviderCredentials, resolveTextProvider } from './textProvider'

export function hasMultimodalProviderCredentials(env: SkillContext['env']): boolean {
  if (env.MULTIMODAL_USE_TEXT_PROVIDER === 'true') {
    return !!env.DEFAULT_MULTIMODAL_MODEL?.trim() && hasTextProviderCredentials(env)
  }
  return !!env.QWEN_API_KEY
}

export interface QwenMultimodalProviderConfig {
  runtime?: SkillContext['env']['RUNTIME_CONTROL']
  mock?: boolean
  maxOutputTokens?: number
  model: string
  apiKey: string
  url: string
}

const QWEN_MULTIMODAL_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

/**
 * Only explicitly enabled, configured vision models reuse the text endpoint.
 */
export function resolveQwenMultimodalProviderConfig(
  input: SkillInput,
  context: SkillContext
): QwenMultimodalProviderConfig | null {
  const mock = context.env.ENVIRONMENT === 'development' && context.env.MOCK_MODEL === 'true'
  if (!hasMultimodalProviderCredentials(context.env) && !mock) {
    return null
  }

  const requestedModel = typeof input.model === 'string' ? input.model : ''
  const model = resolveMultimodalModel(requestedModel, context.env)
  if (!mock && context.env.MULTIMODAL_USE_TEXT_PROVIDER === 'true') {
    return resolveTextProvider({ ...input, model }, context)
  }

  return {
    model,
    apiKey: context.env.QWEN_API_KEY ?? 'local-mock',
    runtime: context.env.RUNTIME_CONTROL,
    mock,
    maxOutputTokens: input.maxTokens,
    url: QWEN_MULTIMODAL_URL
  }
}

/**
 * 本次上传的图片只属于最后一条用户消息，不改写历史消息的语义。
 */
export function buildQwenMultimodalMessages(messages: Message[], images: ImageData[]): unknown[] {
  let lastUserIndex = messages.length - 1
  while (lastUserIndex >= 0 && messages[lastUserIndex].role !== 'user') lastUserIndex--
  return messages.map((message, index) => {
    if (index !== lastUserIndex || images.length === 0) {
      return {
        role: message.role,
        content: message.content
      }
    }

    const content: unknown[] = images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`
      }
    }))

    content.push({
      type: 'text',
      text: message.content || '请描述这张图片'
    })

    return {
      role: message.role,
      content
    }
  })
}

export async function* executeQwenMultimodalStream(
  providerConfig: QwenMultimodalProviderConfig,
  messages: Message[],
  images: ImageData[],
  temperature: number
): AsyncIterable<SkillStreamChunk> {
  yield* executeChatCompletionStream({
    provider: 'qwen-multimodal',
    model: providerConfig.model,
    url: providerConfig.url,
    apiKey: providerConfig.apiKey,
    runtime: providerConfig.runtime,
    mock: providerConfig.mock,
    body: {
      model: providerConfig.model,
      messages: buildQwenMultimodalMessages(messages, images),
      stream: true,
      max_tokens: providerConfig.maxOutputTokens ?? 2048,
      stream_options: { include_usage: true },
      temperature
    }
  })
}
