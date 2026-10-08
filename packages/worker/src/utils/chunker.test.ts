import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  findSafeSplitPoint,
  splitByTokens,
  splitTextRanges,
} from "./chunker";
import { isTextBoundary } from "./textBoundaries";

describe("lossless token-bounded text partition", () => {
  it("preserves whitespace and original Unicode under token and character limits", () => {
    let seed = 704193;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const units = [
      "ab ",
      "\t",
      "\r\n",
      "\r",
      "\n",
      "中文",
      "😀",
      "é",
      "e\u0301",
      "\ud800",
    ];
    for (let trial = 0; trial < 80; trial++) {
      const text = Array.from(
        { length: (random() % 240) + 1 },
        () => units[random() % units.length],
      ).join("");
      const tokens = (random() % 30) + 2;
      const chars = (random() % 50) + 2;
      const ranges = splitTextRanges(text, tokens, chars);
      expect(
        ranges
          .map((range) => text.slice(range.startOffset, range.endOffset))
          .join(""),
      ).toBe(text);
      let previous = 0;
      for (const range of ranges) {
        expect(range.startOffset).toBe(previous);
        expect(range.endOffset).toBeGreaterThan(range.startOffset);
        expect(isTextBoundary(text, range.startOffset)).toBe(true);
        expect(isTextBoundary(text, range.endOffset)).toBe(true);
        expect(range.endOffset - range.startOffset).toBeLessThanOrEqual(chars);
        expect(range.tokenCount).toBe(
          estimateTokens(text.slice(range.startOffset, range.endOffset)),
        );
        expect(range.tokenCount).toBeLessThanOrEqual(tokens);
        previous = range.endOffset;
      }
    }
  });

  it("never seeks a natural break beyond a hard upper bound", () => {
    const text = "abcd😀xx\r\nnext. sentence\n\nlast";
    for (let target = 0; target <= text.length; target++) {
      const split = findSafeSplitPoint(text, target);
      expect(split).toBeLessThanOrEqual(target);
      expect(isTextBoundary(text, split)).toBe(true);
    }
    expect(splitByTokens(" \n\t", 2).join("")).toBe(" \n\t");
    expect(splitByTokens("", 2)).toEqual([]);
  });

  it("rejects invalid budgets and indivisible units instead of silently exceeding them", () => {
    for (const budget of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => splitTextRanges("x", budget)).toThrow(RangeError);
    }
    expect(() => splitTextRanges("😀", 1)).toThrow(RangeError);
    expect(() => splitTextRanges("\r\n", 2, 1)).toThrow(RangeError);
  });
});
