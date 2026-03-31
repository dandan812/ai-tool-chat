import { describe, expect, it } from 'vitest';
import { pickWelcomeSuggestions } from './welcomeSuggestions';

describe('welcomeSuggestions', () => {
  it('应该按指定数量返回建议卡片', () => {
    const suggestions = pickWelcomeSuggestions(3);

    expect(suggestions).toHaveLength(3);
    expect(suggestions[0]).toHaveProperty('title');
    expect(suggestions[0]).toHaveProperty('prompt');
  });

  it('返回数量不应超过可用建议总数', () => {
    const suggestions = pickWelcomeSuggestions(20);

    expect(suggestions.length).toBeLessThanOrEqual(6);
  });
});
