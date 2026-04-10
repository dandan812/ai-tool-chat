import type {
  ImageData,
  Message,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { resolveDefaultMultimodalModel } from '../utils/textModel';
import { executeChatCompletionStream } from './chatCompletionStream';

export interface QwenMultimodalProviderConfig {
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
  if (!context.env.QWEN_API_KEY) {
    return null;
  }

  const requestedModel = typeof input.model === 'string' ? input.model : '';
  const model = requestedModel.startsWith('qwen')
    ? requestedModel
    : resolveDefaultMultimodalModel(context.env);

  return {
    model,
    apiKey: context.env.QWEN_API_KEY,
    url: QWEN_MULTIMODAL_URL,
  };
}

/**
 * 这里保留现有数据拼接方式：
 * 只要当前请求携带图片，所有用户消息都会附带这些图片。
 * 这不是最理想的长期形态，但它能保持现有前端请求语义不变，避免这轮重构顺手改行为。
 */
export function buildQwenMultimodalMessages(
  messages: Message[],
  images: ImageData[],
): unknown[] {
  return messages.map((message) => {
    if (message.role !== 'user' || images.length === 0) {
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
    body: {
      model: providerConfig.model,
      messages: buildQwenMultimodalMessages(messages, images),
      stream: true,
      temperature,
    },
  });
}
