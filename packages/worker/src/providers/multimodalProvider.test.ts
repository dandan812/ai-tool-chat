import { describe, expect, it } from 'vitest';
import { buildQwenMultimodalMessages, resolveQwenMultimodalProviderConfig } from './multimodalProvider';
import { createMockEnv } from '../test/mocks';

describe('resolveQwenMultimodalProviderConfig', () => {
  it.each([
    ['glm-5', 'qwen-vl-plus'],
    ['qwen-vl-max', 'qwen-vl-max'],
    ['qwen3-vl-plus', 'qwen3-vl-plus'],
    ['configured-vision-model', 'configured-vision-model'],
  ])('直接调用 provider 也遵守图片模型规则：%s', (requested, expected) => {
    const config = resolveQwenMultimodalProviderConfig(
      { messages: [], model: requested },
      { env: createMockEnv({
        QWEN_API_KEY: 'test-key',
        DEFAULT_MULTIMODAL_MODEL: requested === 'configured-vision-model' ? requested : 'qwen-vl-plus',
      }) },
    );
    expect(config?.model).toBe(expected);
  });
});

describe('buildQwenMultimodalMessages', () => {
  it('当前图片不附加到历史用户消息，不修改原始消息', () => {
    const original = [
      { role: 'user' as const, content: 'previous question' },
      { role: 'assistant' as const, content: 'previous answer' },
      { role: 'user' as const, content: 'current question' },
    ];
    const result = buildQwenMultimodalMessages(original, [{ id: 'current', base64: 'AAAA', mimeType: 'image/png' }]);
    expect(result.slice(0, 2)).toEqual(original.slice(0, 2));
    expect(result[2]).toMatchObject({ role: 'user', content: expect.any(Array) });
    expect(original[2].content).toBe('current question');
  });
  it('有图片时应把用户消息转换成 Qwen 多模态数组格式', () => {
    const messages = buildQwenMultimodalMessages(
      [{ role: 'user', content: '请描述图片' }],
      [{ id: 'img-1', base64: 'abc', mimeType: 'image/png' }],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,abc',
          },
        },
        {
          type: 'text',
          text: '请描述图片',
        },
      ],
    });
  });
});
