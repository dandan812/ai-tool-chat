import type { Message, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import {
  DEFAULT_QWEN_TEXT_MODEL,
  isBailianTextModel,
  resolveDefaultTextModel,
} from '../model/textModel';
import { executeChatCompletionStream } from './chatCompletionStream';

export type TextProviderName = 'bailian';

export interface TextProviderConfig {
  provider: TextProviderName;
  model: string;
  url: string;
  apiKey: string;
}

const TEXT_PROVIDER_ENDPOINTS: Record<TextProviderName, string> = {
  bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

/**
 * 解析当前请求最终应走哪个文本模型。
 *
 * 当前项目统一只走百炼兼容接口，因此这里不再区分 OpenAI / DeepSeek / GLM。
 * 只要模型名属于百炼支持范围，并且存在 QWEN_API_KEY，就统一落到同一个 provider。
 */
export function resolveTextProvider(
  input: SkillInput,
  context: SkillContext,
): TextProviderConfig | null {
  const requestedModel = typeof input.model === 'string' ? input.model : '';
  const defaultModel = resolveDefaultTextModel(context.env);

  return (
    resolveRequestedProvider(requestedModel, context) ??
    resolveDefaultProvider(defaultModel, context) ??
    resolveAvailableProviderFallback(context)
  );
}

function resolveRequestedProvider(
  model: string,
  context: SkillContext,
): TextProviderConfig | null {
  if (isBailianTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', model, context.env.QWEN_API_KEY);
  }

  return null;
}

function resolveDefaultProvider(
  model: string,
  context: SkillContext,
): TextProviderConfig | null {
  if (isBailianTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', model, context.env.QWEN_API_KEY);
  }

  return null;
}

function resolveAvailableProviderFallback(
  context: SkillContext,
): TextProviderConfig | null {
  if (context.env.QWEN_API_KEY) {
    return createProviderConfig('bailian', DEFAULT_QWEN_TEXT_MODEL, context.env.QWEN_API_KEY);
  }

  return null;
}

function createProviderConfig(
  provider: TextProviderName,
  model: string,
  apiKey: string,
): TextProviderConfig {
  return {
    provider,
    model,
    url: TEXT_PROVIDER_ENDPOINTS[provider],
    apiKey,
  };
}

/**
 * 文本 Skill 不再自己维护一套 fetch + SSE 读取逻辑，
 * 而是直接复用通用的 OpenAI 兼容流式执行器。
 * 这样以后调整日志、超时或流式解析规则时，只需要改一处。
 */
export async function* executeTextProviderStream(
  providerConfig: TextProviderConfig,
  messages: Message[],
  temperature: number,
): AsyncIterable<SkillStreamChunk> {
  yield* executeChatCompletionStream({
    provider: providerConfig.provider,
    model: providerConfig.model,
    url: providerConfig.url,
    apiKey: providerConfig.apiKey,
    body: {
      model: providerConfig.model,
      messages,
      stream: true,
      temperature,
    },
  });
}
