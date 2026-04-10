/**
 * GLM Skill - 基于智谱 AI GLM API
 *
 * 这个 Skill 现在只保留两层职责：
 *   1. 作为 Skill 注册中心中的一个文本执行入口
 *   2. 负责 GLM 路径的输入校验和最终错误兜底
 *
 * 真正的请求构造、超时控制和 SSE 解析已经下沉到 provider 层，
 * 这样可以避免每个 Skill 都各自维护一份几乎相同的流式请求代码。
 */
import type {
  Skill,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { logger } from '../utils/logger';
import {
  executeGlmProviderStream,
  resolveGlmProviderConfig,
} from '../providers/glmProvider';

export const glmSkill: Skill = {
  name: 'glm-chat',
  type: 'text',
  description: '基于智谱 AI GLM 的文本对话技能',

  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { messages, temperature = 0.7 } = input;
    const providerConfig = resolveGlmProviderConfig(input, context);

    if (!providerConfig) {
      logger.error('GLM_API_KEY not configured');
      yield { type: 'error', error: 'GLM_API_KEY 环境变量未配置' };
      return;
    }

    try {
      yield* executeGlmProviderStream(providerConfig, messages, temperature);
    } catch (error) {
      logger.error('GLM API request failed', error);

      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'error', error: 'GLM API 请求超时（30秒），请稍后重试' };
      } else {
        yield { type: 'error', error: String(error) };
      }
    }
  },
};
