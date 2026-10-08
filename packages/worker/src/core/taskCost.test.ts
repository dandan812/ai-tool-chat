import { describe, expect, it } from 'vitest';
import type { ModelUsage } from '../types';
import { estimateTaskCost } from './taskCost';

const rates = JSON.stringify({ 'model-a': { inputPerMillion: 1, outputPerMillion: 2, currency: 'CNY' },
  'model-b': { inputPerMillion: 3, outputPerMillion: 4, currency: 'CNY' } });
const usage: ModelUsage = { callId: 'c1', model: 'model-a', inputTokens: 1000000, outputTokens: 500000, tokenSource: 'provider', outcome: 'completed' };
const unknown = { estimatedCost: null, currency: null, costSource: 'unknown' };

describe('administrator-configured task cost estimates', () => {
  it('estimates provider and estimated tokens but never presents the result as an invoice', () => {
    for (const tokenSource of ['provider', 'estimated'] as const) {
      expect(estimateTaskCost(rates, [{ ...usage, tokenSource }])).toEqual({ estimatedCost: 2, currency: 'CNY', costSource: 'estimated' });
    }
  });
  it('aggregates different models only when all rates and currencies are known', () => {
    expect(estimateTaskCost(rates, [usage, { ...usage, callId: 'c2', model: 'model-b', tokenSource: 'estimated' }]))
      .toEqual({ estimatedCost: 7, currency: 'CNY', costSource: 'estimated' });
    const mixed = JSON.stringify({ 'model-a': { inputPerMillion: 1, outputPerMillion: 2, currency: 'CNY' },
      'model-b': { inputPerMillion: 3, outputPerMillion: 4, currency: 'USD' } });
    expect(estimateTaskCost(mixed, [usage, { ...usage, callId: 'c2', model: 'model-b' }])).toEqual(unknown);
    expect(estimateTaskCost(rates, [usage, { ...usage, callId: 'c2', model: 'unpriced' }])).toEqual(unknown);
  });
  it.each([undefined, '', '{broken', 'null', '[]', '"text"', '{}'])('treats absent or unusable price config %s as unknown', config => {
    expect(estimateTaskCost(config, [usage])).toEqual(unknown);
  });
  it.each([
    { inputPerMillion: -1, outputPerMillion: 2, currency: 'CNY' },
    { inputPerMillion: '1', outputPerMillion: 2, currency: 'CNY' },
    { inputPerMillion: 1, outputPerMillion: null, currency: 'CNY' },
    { inputPerMillion: 1, outputPerMillion: 2, currency: '' },
    { inputPerMillion: 1, outputPerMillion: 2, currency: 'cny' },
    { inputPerMillion: 1, currency: 'CNY' },
  ])('rejects malformed rates without interpreting them as zero (%j)', rate => {
    expect(estimateTaskCost(JSON.stringify({ 'model-a': rate }), [usage])).toEqual(unknown);
  });
  it.each([
    { inputTokens: undefined }, { outputTokens: undefined }, { inputTokens: -1 }, { outputTokens: 1.5 },
    { inputTokens: Number.NaN }, { outputTokens: Number.POSITIVE_INFINITY },
    { tokenSource: 'unknown' as const }, { outcome: 'unknown' as const },
  ])('treats any missing or uncertain call usage as an unknown whole-task total (%j)', patch => {
    expect(estimateTaskCost(rates, [usage, { ...usage, callId: 'c2', ...patch }])).toEqual(unknown);
  });
  it('accepts explicitly configured free rates and actual zero usage, but not absent usage', () => {
    const free = JSON.stringify({ 'model-a': { inputPerMillion: 0, outputPerMillion: 0, currency: 'CNY' } });
    expect(estimateTaskCost(free, [usage])).toEqual({ estimatedCost: 0, currency: 'CNY', costSource: 'estimated' });
    expect(estimateTaskCost(rates, [{ ...usage, inputTokens: 0, outputTokens: 0 }])).toEqual({ estimatedCost: 0, currency: 'CNY', costSource: 'estimated' });
    expect(estimateTaskCost(free, [{ ...usage, inputTokens: undefined }])).toEqual(unknown);
    expect(estimateTaskCost(rates, [])).toEqual(unknown);
  });
  it('does not overflow or round a small real estimate down to a displayed free charge', () => {
    expect(estimateTaskCost(rates, [{ ...usage, inputTokens: 1, outputTokens: 1 }]).estimatedCost).toBeCloseTo(0.000003, 10);
    const huge = JSON.stringify({ 'model-a': { inputPerMillion: 1e308, outputPerMillion: 1e308, currency: 'CNY' } });
    expect(estimateTaskCost(huge, [{ ...usage, inputTokens: Number.MAX_SAFE_INTEGER }])).toEqual(unknown);
  });
});
