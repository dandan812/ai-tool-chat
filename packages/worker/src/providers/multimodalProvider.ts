import type {
  ImageData,
  Message,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { resolveMultimodalModel } from '../model/defaultModels';
import { executeChatCompletionStream } from './chatCompletionStream';

export interface QwenMultimodalProviderConfig {
  runtime?: SkillContext["env"]["RUNTIME_CONTROL"];
  mock?: boolean;
  maxOutputTokens?: number;
  model: string;
  apiKey: string;
  url: string;
}

const QWEN_MULTIMODAL_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

/**
 * 当前多模态能力只主打阿里云百炼，因此这里明确收口为 Qwen provider。
 * 如果以后要补其他视觉模型，扩展点应放在 provider 层，而不是回到 Skill 中堆分支。
 */
export function resolveQwenMultimodalProviderConfig(
  input: SkillInput,
  context: SkillContext,
): QwenMultimodalProviderConfig | null {
  const mock = context.env.ENVIRONMENT === "development" && context.env.MOCK_MODEL === "true";
  if (!context.env.QWEN_API_KEY && !mock) {
    return null;
  }

  const requestedModel = typeof input.model === 'string' ? input.model : '';
  const model = resolveMultimodalModel(requestedModel, context.env);

  return {
    model,
    apiKey: context.env.QWEN_API_KEY ?? "local-mock",
    runtime: context.env.RUNTIME_CONTROL,
    mock,
    maxOutputTokens: input.maxTokens,
    url: QWEN_MULTIMODAL_URL,
  };
}

/**
 * 本次上传的图片只属于最后一条用户消息，不改写历史消息的语义。
 */
export function buildQwenMultimodalMessages(
  messages: Message[],
  images: ImageData[],
): unknown[] {
  let lastUserIndex = messages.length - 1;
  while (lastUserIndex >= 0 && messages[lastUserIndex].role !== 'user') lastUserIndex--;
  return messages.map((message, index) => {
    if (index !== lastUserIndex || images.length === 0) {
      return {
        role: message.role,
        content: message.content,
      };
    }

    const content: unknown[] = images.map((image) => ({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
      },
    }));

    content.push({
      type: 'text',
      text: message.content || '请描述这张图片',
    });

    return {
      role: message.role,
      content,
    };
  });
}

export async function* executeQwenMultimodalStream(
  providerConfig: QwenMultimodalProviderConfig,
  messages: Message[],
  images: ImageData[],
  temperature: number,
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
      temperature,
    },
  });
}
