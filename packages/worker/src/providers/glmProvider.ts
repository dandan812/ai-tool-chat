import type {
  Message,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { executeChatCompletionStream } from './chatCompletionStream';

export interface GlmProviderConfig {
  model: string;
  apiKey: string;
  url: string;
}

const GLM_CHAT_COMPLETIONS_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const GLM_REQUEST_TIMEOUT_MS = 30_000;

/**
 * 解析 GLM 文本请求最终应使用的模型。
 *
 * 这里沿用旧行为：
 * - 显式指定 glm* 模型时优先使用请求模型
 * - 否则如果 DEFAULT_MODEL 本身就是 glm*，继续沿用默认模型
 * - 再兜底到 glm-5
 */
export function resolveGlmProviderConfig(
  input: SkillInput,
  context: SkillContext,
): GlmProviderConfig | null {
  const apiKey = context.env.GLM_API_KEY as string | undefined;
  if (!apiKey) {
    return null;
  }

  const requestedModel = typeof input.model === 'string' ? input.model : '';
  const model = requestedModel.startsWith('glm')
    ? requestedModel
    : context.env.DEFAULT_MODEL?.startsWith('glm')
      ? context.env.DEFAULT_MODEL
      : 'glm-5';

  return {
    model,
    apiKey,
    url: GLM_CHAT_COMPLETIONS_URL,
  };
}

export async function* executeGlmProviderStream(
  providerConfig: GlmProviderConfig,
  messages: Message[],
  temperature: number,
): AsyncIterable<SkillStreamChunk> {
  yield* executeChatCompletionStream({
    provider: 'glm',
    model: providerConfig.model,
    url: providerConfig.url,
    apiKey: providerConfig.apiKey,
    timeoutMs: GLM_REQUEST_TIMEOUT_MS,
    body: {
      model: providerConfig.model,
      messages,
      stream: true,
      temperature: temperature ?? 1,
      top_p: 0.95,
      do_sample: true,
    },
  });
}
