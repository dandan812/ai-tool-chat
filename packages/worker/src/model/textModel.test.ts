import { describe, expect, it } from 'vitest';
import {
  getTextModelProviderLabel,
  isBailianTextModel,
  resolveDefaultMultimodalModel,
  resolveDefaultTextModel,
} from './textModel';

describe('textModel', () => {
  it('只有百炼 key 时应返回默认文本模型', () => {
    expect(resolveDefaultTextModel({ QWEN_API_KEY: 'qwen-key' })).toBe('qwen3.5-flash-2026-02-23');
  });

  it('没有显式模型时不应再回退到 glm-5', () => {
    expect(resolveDefaultTextModel()).not.toBe('glm-5');
  });

  it('应识别百炼兼容的文本模型前缀', () => {
    expect(isBailianTextModel('qwen3.5-flash-2026-02-23')).toBe(true);
    expect(isBailianTextModel('kimi-k2.5')).toBe(true);
    expect(isBailianTextModel('MiniMax-M2.5')).toBe(true);
  });

  it('应统一返回百炼供应商标签', () => {
    expect(getTextModelProviderLabel('kimi-k2.5')).toBe('百炼');
  });

  it('未配置时应返回默认多模态模型', () => {
    expect(resolveDefaultMultimodalModel()).toBe('qwen3.5-plus');
  });
});
