import { describe, expect, it } from 'vitest';
import { parseChatCompletionSSELine } from './sse';

describe('parseChatCompletionSSELine', () => {
  it('应解析普通文本 content', () => {
    const chunk = parseChatCompletionSSELine(
      'data: {"choices":[{"delta":{"content":"你好"}}]}',
    );

    expect(chunk).toEqual({ type: 'content', content: '你好' });
  });

  it('应解析多模态数组中的文本块', () => {
    const chunk = parseChatCompletionSSELine(
      'data: {"choices":[{"delta":{"content":[{"type":"text","text":"图片里是一只猫"}]}}]}',
    );

    expect(chunk).toEqual({ type: 'content', content: '图片里是一只猫' });
  });

  it('应忽略不包含文本的内容块', () => {
    const chunk = parseChatCompletionSSELine(
      'data: {"choices":[{"delta":{"content":[{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]}}]}',
    );

    expect(chunk).toBeNull();
  });
});
