import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QWEN_FILE_MODEL,
  DEFAULT_QWEN_MULTIMODAL_MODEL,
  DEFAULT_QWEN_TEXT_MODEL,
  resolveDefaultFileModel,
  resolveDefaultMultimodalModel,
  resolveDefaultModelConfig,
  resolveDefaultTextModel,
} from './defaultModels';
import {
  getTextModelProviderLabel,
  isBailianTextModel,
} from './textModel';

describe('textModel', () => {
  it('只有百炼 key 时应返回默认文本模型', () => {
    expect(resolveDefaultTextModel({ QWEN_API_KEY: 'qwen-key' })).toBe(DEFAULT_QWEN_TEXT_MODEL);
  });

  it('显式配置 DEFAULT_MODEL 时应优先返回配置值', () => {
    expect(resolveDefaultTextModel({ DEFAULT_MODEL: 'kimi-k2.5' })).toBe('kimi-k2.5');
  });

  it('未配置 DEFAULT_FILE_MODEL 时应回退到文本默认模型', () => {
    expect(resolveDefaultFileModel({ DEFAULT_MODEL: 'qwen-plus' })).toBe('qwen-plus');
    expect(resolveDefaultFileModel()).toBe(DEFAULT_QWEN_FILE_MODEL);
  });

  it('显式配置 DEFAULT_FILE_MODEL 时应优先返回文件模型配置', () => {
    expect(
      resolveDefaultFileModel({
        DEFAULT_MODEL: 'qwen-plus',
        DEFAULT_FILE_MODEL: 'qwen-long',
      }),
    ).toBe('qwen-long');
  });

  it('应统一返回三类默认模型配置', () => {
    expect(
      resolveDefaultModelConfig({
        DEFAULT_MODEL: 'qwen-plus',
        DEFAULT_FILE_MODEL: 'qwen-long',
        DEFAULT_MULTIMODAL_MODEL: 'qwen-vl-max',
      }),
    ).toEqual({
      text: 'qwen-plus',
      file: 'qwen-long',
      multimodal: 'qwen-vl-max',
    });
  });

  it('应识别百炼兼容的文本模型前缀', () => {
    expect(isBailianTextModel('qwen3.5-flash-2026-02-23')).toBe(true);
    expect(isBailianTextModel('kimi-k2.5')).toBe(true);
    expect(isBailianTextModel('MiniMax-M2.5')).toBe(true);
    expect(isBailianTextModel('glm-5')).toBe(false);
  });

  it('应统一返回百炼供应商标签', () => {
    expect(getTextModelProviderLabel('kimi-k2.5')).toBe('百炼');
  });

  it('未配置时应返回默认多模态模型', () => {
    expect(resolveDefaultMultimodalModel()).toBe(DEFAULT_QWEN_MULTIMODAL_MODEL);
  });
});
