import { describe, expect, it } from 'vitest';
import { createMockEnv, MemoryR2Bucket } from '../test/mocks';
import type { ResolvedFileContent } from '../types';
import {
  formatRetrievedText,
  getOrCreateTextRetrievalIndex,
  retrieveOverviewText,
  retrieveRelevantText,
} from './textRetriever';

function createResolvedFile(content: string): ResolvedFileContent {
  return {
    fileId: 'file-1',
    fileName: 'notes.txt',
    mimeType: 'text/plain',
    size: content.length,
    fileHash: 'hash-1',
    source: 'uploaded',
    content,
  };
}

describe('textRetriever', () => {
  it('应该创建并缓存文本检索索引', async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      '第一章介绍系统背景。\n第二章讲文件上传。\n第三章讲文本检索与 token 优化。',
    );

    const first = await getOrCreateTextRetrievalIndex(env, file, 200);
    const second = await getOrCreateTextRetrievalIndex(env, file, 200);
    const cachedObject = await (env.UPLOADED_FILES as unknown as MemoryR2Bucket).get(
      'uploaded-file-indices/file-1.json',
    );

    expect(first.chunks.length).toBeGreaterThan(0);
    expect(second.createdAt).toBe(first.createdAt);
    await expect(cachedObject?.text()).resolves.toContain('"version":1');
  });

  it('应该优先返回和问题最相关的片段', async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      [
        '系统概览：本项目使用 Task Step Skill 架构。',
        '上传流程：文件会切片上传到 Worker，再写入 R2。',
        '文本检索：系统会根据问题只选择相关片段进入模型。',
      ].join('\n\n'),
    );
    const index = await getOrCreateTextRetrievalIndex(env, file, 120);

    const result = retrieveRelevantText([index], '文本检索是怎么节省 token 的？', {
      chunkSizeTokens: 120,
      topK: 4,
      maxPromptTokens: 1000,
      minRelevance: 0.05,
    });
    const formatted = formatRetrievedText(result);

    expect(result.selectedChunks.length).toBeGreaterThan(0);
    expect(result.selectedChunks[0]?.content).toContain('文本检索');
    expect(formatted).toContain('文本检索结果');
  });

  it('概览模式应该从不同位置抽取代表性片段', async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      Array.from(
        { length: 24 },
        (_, index) => `第 ${index + 1} 段：这里是正文内容，包含背景、细节、时间线和补充说明。`.repeat(12),
      ).join('\n\n'),
    );
    const index = await getOrCreateTextRetrievalIndex(env, file, 30);

    const result = retrieveOverviewText([index], '请概括整份文件', {
      topK: 4,
      maxPromptTokens: 1600,
    });

    expect(result.selectedChunks.length).toBeGreaterThan(1);
    expect(result.selectedChunks[0]?.chunkIndex).toBe(0);
  });
});
