import { describe, expect, it } from 'vitest';
import type { SkillContext, SkillInput } from '../types';
import { resolveGlmProviderConfig } from './glmProvider';

function createContext(env: Partial<SkillContext['env']>): SkillContext {
  return {
    taskId: 'task-1',
    stepId: 'step-1',
    env: env as SkillContext['env'],
    mcpClient: {} as SkillContext['mcpClient'],
  };
}

function createInput(model?: string): SkillInput {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model,
  };
}

describe('resolveGlmProviderConfig', () => {
  it('显式指定 glm 模型时优先使用请求模型', () => {
    const config = resolveGlmProviderConfig(
      createInput('glm-4-flash'),
      createContext({ GLM_API_KEY: 'glm-key', DEFAULT_MODEL: 'glm-5' }),
    );

    expect(config?.model).toBe('glm-4-flash');
  });

  it('未显式指定时沿用默认的 glm 模型', () => {
    const config = resolveGlmProviderConfig(
      createInput(),
      createContext({ GLM_API_KEY: 'glm-key', DEFAULT_MODEL: 'glm-5-air' }),
    );

    expect(config?.model).toBe('glm-5-air');
  });
});
