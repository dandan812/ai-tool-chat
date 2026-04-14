import { describe, expect, it } from 'vitest';
import type { SkillContext, SkillInput } from '../types';
import { DEFAULT_QWEN_TEXT_MODEL } from '../model/textModel';
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
  it('默认优先走百炼兜底供应商', () => {
    const provider = resolveTextProvider(
      createInput(),
      createContext({ QWEN_API_KEY: 'qwen-key' }),
    );

    expect(provider).not.toBeNull();
    expect(provider?.provider).toBe('bailian');
    expect(provider?.model).toBe(DEFAULT_QWEN_TEXT_MODEL);
  });

  it('显式指定 kimi 模型时仍然走百炼兼容接口', () => {
    const provider = resolveTextProvider(
      createInput('kimi-k2.5'),
      createContext({ QWEN_API_KEY: 'qwen-key' }),
    );

    expect(provider?.provider).toBe('bailian');
    expect(provider?.model).toBe('kimi-k2.5');
  });

  it('显式指定 minimax 模型时仍然走百炼兼容接口', () => {
    const provider = resolveTextProvider(
      createInput('MiniMax-M2.5'),
      createContext({ QWEN_API_KEY: 'qwen-key' }),
    );

    expect(provider?.provider).toBe('bailian');
    expect(provider?.model).toBe('MiniMax-M2.5');
  });

  it('默认模型显式配置为百炼模型时应命中百炼', () => {
    const provider = resolveTextProvider(
      createInput(),
      createContext({
        DEFAULT_MODEL: DEFAULT_QWEN_TEXT_MODEL,
        QWEN_API_KEY: 'qwen-key',
      }),
    );

    expect(provider?.provider).toBe('bailian');
    expect(provider?.model).toBe(DEFAULT_QWEN_TEXT_MODEL);
  });
});
