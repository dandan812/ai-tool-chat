import { describe, expect, it } from 'vitest';
import type { SkillContext, SkillInput } from '../types';
import { resolveTextProvider } from './textProvider';

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

describe('resolveTextProvider', () => {
  it('默认优先走 Qwen 兜底供应商', () => {
    const provider = resolveTextProvider(
      createInput(),
      createContext({ QWEN_API_KEY: 'qwen-key' }),
    );

    expect(provider).not.toBeNull();
    expect(provider?.provider).toBe('qwen');
    expect(provider?.model).toBe('qwen3.5-flash-2026-02-23');
  });

  it('显式指定 DeepSeek 模型时优先走 DeepSeek', () => {
    const provider = resolveTextProvider(
      createInput('deepseek-chat'),
      createContext({
        QWEN_API_KEY: 'qwen-key',
        DEEPSEEK_API_KEY: 'deepseek-key',
      }),
    );

    expect(provider?.provider).toBe('deepseek');
    expect(provider?.model).toBe('deepseek-chat');
  });

  it('默认模型显式配置为 Qwen 时应命中 Qwen', () => {
    const provider = resolveTextProvider(
      createInput(),
      createContext({
        DEFAULT_MODEL: 'qwen3.5-flash-2026-02-23',
        QWEN_API_KEY: 'qwen-key',
        OPENAI_API_KEY: 'openai-key',
      }),
    );

    expect(provider?.provider).toBe('qwen');
    expect(provider?.model).toBe('qwen3.5-flash-2026-02-23');
  });
});
