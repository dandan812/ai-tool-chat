import { describe, expect, it } from 'vitest';
import { buildQwenMultimodalMessages } from './multimodalProvider';

describe('buildQwenMultimodalMessages', () => {
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
