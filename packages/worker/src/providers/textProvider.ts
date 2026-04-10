import type { Message, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import {
  DEFAULT_DEEPSEEK_TEXT_MODEL,
  DEFAULT_OPENAI_TEXT_MODEL,
  DEFAULT_QWEN_TEXT_MODEL,
  isDeepSeekTextModel,
  isOpenAITextModel,
  isQwenTextModel,
  resolveDefaultTextModel,
} from '../utils/textModel';
import { executeChatCompletionStream } from './chatCompletionStream';

export type TextProviderName = 'openai' | 'deepseek' | 'qwen';

export interface TextProviderConfig {
  provider: TextProviderName;
  model: string;
  url: string;
  apiKey: string;
}

const TEXT_PROVIDER_ENDPOINTS: Record<TextProviderName, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

/**
 * 解析当前请求最终应走哪个文本供应商。
 * 优先遵循显式模型，其次遵循默认模型，最后按现有 Key 做兜底。
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
  if (isOpenAITextModel(model) && context.env.OPENAI_API_KEY) {
    return createProviderConfig('openai', model, context.env.OPENAI_API_KEY);
  }

  if (isDeepSeekTextModel(model) && context.env.DEEPSEEK_API_KEY) {
    return createProviderConfig('deepseek', model, context.env.DEEPSEEK_API_KEY);
  }

  if (isQwenTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('qwen', model, context.env.QWEN_API_KEY);
  }

  return null;
}

function resolveDefaultProvider(
  model: string,
  context: SkillContext,
): TextProviderConfig | null {
  if (isQwenTextModel(model) && context.env.QWEN_API_KEY) {
    return createProviderConfig('qwen', model, context.env.QWEN_API_KEY);
  }

  if (isOpenAITextModel(model) && context.env.OPENAI_API_KEY) {
    return createProviderConfig('openai', model, context.env.OPENAI_API_KEY);
  }

  if (isDeepSeekTextModel(model) && context.env.DEEPSEEK_API_KEY) {
    return createProviderConfig('deepseek', model, context.env.DEEPSEEK_API_KEY);
  }

  return null;
}

function resolveAvailableProviderFallback(
  context: SkillContext,
): TextProviderConfig | null {
  // 当前项目主用阿里云百炼，兜底时优先返回 Qwen。
  if (context.env.QWEN_API_KEY) {
    return createProviderConfig('qwen', DEFAULT_QWEN_TEXT_MODEL, context.env.QWEN_API_KEY);
  }

  if (context.env.OPENAI_API_KEY) {
    return createProviderConfig('openai', DEFAULT_OPENAI_TEXT_MODEL, context.env.OPENAI_API_KEY);
  }

  if (context.env.DEEPSEEK_API_KEY) {
    return createProviderConfig('deepseek', DEFAULT_DEEPSEEK_TEXT_MODEL, context.env.DEEPSEEK_API_KEY);
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
