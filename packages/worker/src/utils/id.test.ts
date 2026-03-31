import { describe, expect, it } from 'vitest';
import {
  generateId,
  generateShortId,
  generateStepId,
  generateTaskId,
  generateULID,
  now,
} from './id';

describe('ID 工具', () => {
  it('generateId 应该生成唯一值', () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
  });

  it('generateULID 应该符合预期格式', () => {
    const ulid = generateULID();

    expect(ulid).toHaveLength(26);
    expect(ulid).toMatch(/^[0-9a-z]{26}$/i);
  });

  it('generateShortId 应该返回 8 位字符串', () => {
    expect(generateShortId()).toHaveLength(8);
  });

  it('generateTaskId 和 generateStepId 应该带前缀', () => {
    expect(generateTaskId()).toMatch(/^task-/);
    expect(generateStepId()).toMatch(/^step-/);
  });

  it('now 应该返回当前时间戳', () => {
    const before = Date.now();
    const current = now();
    const after = Date.now();

    expect(current).toBeGreaterThanOrEqual(before);
    expect(current).toBeLessThanOrEqual(after);
  });
});
