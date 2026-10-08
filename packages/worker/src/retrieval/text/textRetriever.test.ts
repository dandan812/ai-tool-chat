import { describe, expect, it } from "vitest";
import { createMockEnv, MemoryR2Bucket } from "../../test/mocks";
import type { ResolvedFileContent } from "../../types";
import {
  formatRetrievedText,
  buildTextRetrievalIndex,
  getOrCreateTextRetrievalIndex,
  retrieveOverviewText,
  retrieveRelevantText,
} from "./textRetriever";

function createResolvedFile(content: string): ResolvedFileContent {
  return {
    fileId: "file-1",
    fileName: "notes.txt",
    mimeType: "text/plain",
    size: content.length,
    fileHash: "hash-1",
    source: "uploaded",
    content,
  };
}

describe("textRetriever", () => {
  it("keeps all original text within both chunk limits and selects only within the prompt budget", () => {
    const text = "  lease renewal\r\n中文😀 ".repeat(700) + " \n";
    const index = buildTextRetrievalIndex(createResolvedFile(text), 80);
    expect(index.chunks.map((chunk) => chunk.content).join("")).toBe(text);
    expect(
      index.chunks.every(
        (chunk) => chunk.tokenCount <= 80 && chunk.content.length <= 8000,
      ),
    ).toBe(true);
    for (const budget of [0, 1, 40, 80, 160]) {
      const result = retrieveRelevantText([index], "lease renewal", {
        chunkSizeTokens: 80,
        topK: 3,
        maxPromptTokens: budget,
        minRelevance: 0.05,
      });
      expect(result.selectedTokens).toBeLessThanOrEqual(budget);
      expect(result.selectedChunks.length).toBeLessThanOrEqual(3);
      expect(result.selectedTokens).toBe(
        result.selectedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
      );
    }
  });

  it("rebuilds a v2 index rather than reusing incompatible source positions", async () => {
    const env = createMockEnv();
    const file = createResolvedFile("  preserved whitespace\r\nrenewal");
    const old = {
      ...buildTextRetrievalIndex(file, 20),
      version: 2,
      chunks: [],
    };
    await env.UPLOADED_FILES.put(
      "uploaded-file-indices/file-1.json",
      JSON.stringify(old),
    );
    const result = await getOrCreateTextRetrievalIndex(env, file, 20);
    expect(result.version).toBe(3);
    expect(result.chunks.map((chunk) => chunk.content).join("")).toBe(
      file.content,
    );
  });

  it("应该创建并缓存文本检索索引", async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      "第一章介绍系统背景。\n第二章讲文件上传。\n第三章讲文本检索与 token 优化。",
    );

    const first = await getOrCreateTextRetrievalIndex(env, file, 200);
    const second = await getOrCreateTextRetrievalIndex(env, file, 200);
    const cachedObject = await (
      env.UPLOADED_FILES as unknown as MemoryR2Bucket
    ).get("uploaded-file-indices/file-1.json");

    expect(first.chunks.length).toBeGreaterThan(0);
    expect(second.createdAt).toBe(first.createdAt);
    await expect(cachedObject?.text()).resolves.toContain('"version":3');
  });

  it("应该优先返回和问题最相关的片段", async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      [
        "系统概览：本项目使用 Task Step Skill 架构。",
        "上传流程：文件会切片上传到 Worker，再写入 R2。",
        "文本检索：系统会根据问题只选择相关片段进入模型。",
      ].join("\n\n"),
    );
    const index = await getOrCreateTextRetrievalIndex(env, file, 120);

    const result = retrieveRelevantText(
      [index],
      "文本检索是怎么节省 token 的？",
      {
        chunkSizeTokens: 120,
        topK: 4,
        maxPromptTokens: 1000,
        minRelevance: 0.05,
      },
    );
    const formatted = formatRetrievedText(result);

    expect(result.selectedChunks.length).toBeGreaterThan(0);
    expect(result.selectedChunks[0]?.content).toContain("文本检索");
    expect(formatted).toContain("文本检索结果");
  });

  it("概览模式应该从不同位置抽取代表性片段", async () => {
    const env = createMockEnv();
    const file = createResolvedFile(
      Array.from({ length: 24 }, (_, index) =>
        `第 ${index + 1} 段：这里是正文内容，包含背景、细节、时间线和补充说明。`.repeat(
          12,
        ),
      ).join("\n\n"),
    );
    const index = await getOrCreateTextRetrievalIndex(env, file, 30);

    const result = retrieveOverviewText([index], "请概括整份文件", {
      topK: 4,
      maxPromptTokens: 1600,
    });

    expect(result.selectedChunks.length).toBeGreaterThan(1);
    expect(result.selectedChunks[0]?.chunkIndex).toBe(0);
  });
});
