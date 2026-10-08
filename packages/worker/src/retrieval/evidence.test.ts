import { describe, expect, it } from "vitest";
import type { ResolvedFileContent } from "../types";
import { createMockEnv } from "../test/mocks";
import {
  buildTextRetrievalIndex,
  getOrCreateTextRetrievalIndex,
} from "./text/textRetriever";
import {
  auditEvidenceReferences,
  createEvidenceSource,
  limitEvidenceSources,
  MAX_EVIDENCE_EXCERPT_CHARS,
  MAX_EVIDENCE_TOTAL_CHARS,
} from "./evidence";

function file(
  content: string,
  fileId = "fixture-a",
  fileHash = "hash-a",
): ResolvedFileContent {
  return {
    content,
    fileId,
    fileHash,
    fileName: "same-name.txt",
    source: "uploaded",
    mimeType: "text/plain",
    size: content.length,
  };
}

describe("original source evidence invariants", () => {
  it("handles standalone CR and rejects offsets inside CRLF or surrogate pairs", () => {
    const original = file("first\rsecond\r\n😀 third\nlast");
    const start = original.content.indexOf("😀");
    const source = createEvidenceSource(original, start, start + 2);
    expect(source.startLine).toBe(3);
    expect(source.endLine).toBe(3);
    expect(() =>
      createEvidenceSource(original, start + 1, start + 2),
    ).toThrow();
    const crlf = original.content.indexOf("\r\n");
    expect(() => createEvidenceSource(original, 0, crlf + 1)).toThrow();
  });
  it("uses exact original ranges and distinct stable identities, including identical file names", () => {
    const original = file("  αβ\r\nsecond line\n中文😀\n");
    const source = createEvidenceSource(original, 6, 17);
    expect(source.excerpt).toBe(original.content.slice(6, 17));
    expect(source.startLine).toBe(2);
    expect(source.endLine).toBe(2);
    expect(createEvidenceSource(original, 6, 17)).toEqual(source);
    expect(source.sourceId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      createEvidenceSource(file(original.content, "fixture-b"), 6, 17).sourceId,
    ).not.toBe(source.sourceId);
    expect(
      createEvidenceSource(file(original.content, "fixture-a", "hash-b"), 6, 17)
        .sourceId,
    ).not.toBe(source.sourceId);
    expect(createEvidenceSource(original, 6, 18).sourceId).not.toBe(
      source.sourceId,
    );
  });

  it("rejects invalid and oversized ranges instead of inventing source positions", () => {
    for (const [start, end] of [
      [-1, 2],
      [1, 1],
      [0, 100],
      [0.5, 2],
      [0, NaN],
    ]) {
      expect(() => createEvidenceSource(file("hello"), start, end)).toThrow();
    }
    expect(() =>
      createEvidenceSource(file("x".repeat(9000)), 0, 9000),
    ).toThrow();
  });

  it("preserves exact offsets for independent deterministic random Unicode/CRLF texts", () => {
    let state = 915827;
    const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const pieces = [
      "alpha ",
      "中文",
      "😀",
      "\r\n",
      "\n",
      "\t ",
      "\u00a0",
      "é",
      "e\u0301",
    ];
    for (let trial = 0; trial < 32; trial++) {
      const text = Array.from(
        { length: 1700 + (next() % 1700) },
        () => pieces[next() % pieces.length],
      ).join("");
      const original = file(text, `random-${trial}`);
      const index = buildTextRetrievalIndex(original, 400 + (next() % 2800));
      let previousEnd = 0;
      for (const chunk of index.chunks) {
        const source = chunk.evidence;
        expect(source.excerpt).toBe(
          text.slice(source.startOffset, source.endOffset),
        );
        expect(source.excerpt).toBe(chunk.content);
        expect(source.startLine).toBe(
          text.slice(0, source.startOffset).split("\n").length,
        );
        expect(source.endLine).toBe(
          text.slice(0, source.endOffset - 1).split("\n").length,
        );
        expect(text.slice(previousEnd, source.startOffset).trim()).toBe("");
        expect(source.endOffset - source.startOffset).toBeLessThanOrEqual(
          MAX_EVIDENCE_EXCERPT_CHARS,
        );
        expect(source.excerpt).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
        previousEnd = source.endOffset;
      }
      expect(text.slice(previousEnd).trim()).toBe("");
    }
  });

  it("invalidates text index when the uploaded file version changes", async () => {
    const env = createMockEnv();
    await getOrCreateTextRetrievalIndex(env, file("first version"), 400);
    const changed = await getOrCreateTextRetrievalIndex(
      env,
      file("second version", "fixture-a", "hash-b"),
      400,
    );
    expect(changed.chunks[0].evidence.excerpt).toBe("second version");
    expect(changed.fileHash).toBe("hash-b");
  });

  it("bounds evidence size and rejects citation identifiers outside the current message allowlist", () => {
    const sources = Array.from({ length: 20 }, (_, i) =>
      createEvidenceSource(file("x".repeat(7000), `file-${i}`), 0, 7000),
    );
    const bounded = limitEvidenceSources([...sources, sources[0]]);
    expect(
      bounded.reduce((sum, source) => sum + source.excerpt.length, 0),
    ).toBeLessThanOrEqual(MAX_EVIDENCE_TOTAL_CHARS);
    const audit = auditEvidenceReferences(
      `事实 [S:${sources[0].sourceId}] 伪造 [S:other-account-source] [S:javascript:alert(1)]`,
      bounded,
    );
    expect(audit.validIds).toEqual([sources[0].sourceId]);
    expect(audit.invalidIds).toEqual([
      "other-account-source",
      "javascript:alert(1)",
    ]);
    expect(audit.semanticSupport).toBe("not_evaluated");
    expect(
      auditEvidenceReferences("没有引用的猜测", bounded).hasReferences,
    ).toBe(false);
  });
});
