/**
 * 多模态 Skill - 基于 Qwen3.5 视觉理解模型
 *
 * 当前项目的多模态主路径已经明确收口到阿里云百炼，因此 Skill 层不再关心
 * Base64 图片如何拼装成 Qwen 格式，也不再自己维护一套 fetch + SSE 读取逻辑。
 * 这些供应商细节全部下沉到 provider 层，Skill 只表达“这是一次图文对话”。
 */
import type {
  Skill,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { logger } from '../infrastructure/logger';
import {
  executeQwenMultimodalStream,
  resolveQwenMultimodalProviderConfig,
} from '../providers/multimodalProvider';

export const multimodalSkill: Skill = {
  name: 'multimodal-chat',
  type: 'multimodal',
  description: '基于 Qwen3.5 的图文对话技能',

  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { messages, images = [], temperature = 0.7 } = input;
    const providerConfig = resolveQwenMultimodalProviderConfig(input, context);

    if (!providerConfig) {
      yield { type: 'error', error: 'QWEN_API_KEY not configured' };
      return;
    }

    try {
      yield* executeQwenMultimodalStream(
        providerConfig,
        messages,
        images,
        temperature,
      );
    } catch (error) {
      logger.error('Qwen API request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};
