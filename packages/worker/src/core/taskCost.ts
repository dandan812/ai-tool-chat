import type { ModelUsage, TaskMetrics } from '../types';

export type TaskCostEstimate = Pick<TaskMetrics, 'estimatedCost' | 'currency' | 'costSource'>;

export function unknownTaskCost(): TaskCostEstimate {
  return { estimatedCost: null, currency: null, costSource: 'unknown' };
}

/**
 * Uses only administrator-supplied per-million rates, never bundled provider prices.
 * Even provider-reported tokens produce an estimate, not a bill: cached-token discounts,
 * batch/volume discounts, tool/image fees, taxes and other invoice items are not modeled.
 * Missing/invalid usage or a currency mismatch makes the whole total unknown, not free.
 */
export function estimateTaskCost(pricesJSON: string | undefined, usages: readonly ModelUsage[]): TaskCostEstimate {
  if (!pricesJSON || usages.length === 0) return unknownTaskCost();
  let prices: unknown;
  try { prices = JSON.parse(pricesJSON); } catch { return unknownTaskCost(); }
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) return unknownTaskCost();
  let currency: string | null = null;
  let total = 0;
  for (const usage of usages) {
    if (usage.tokenSource === 'unknown' || usage.outcome === 'unknown' ||
      !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens) ||
      usage.inputTokens! < 0 || usage.outputTokens! < 0 || !Object.hasOwn(prices, usage.model)) return unknownTaskCost();
    const candidate = (prices as Record<string, unknown>)[usage.model];
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return unknownTaskCost();
    const rate = candidate as Record<string, unknown>;
    if (typeof rate.inputPerMillion !== 'number' || !Number.isFinite(rate.inputPerMillion) || rate.inputPerMillion < 0 ||
      typeof rate.outputPerMillion !== 'number' || !Number.isFinite(rate.outputPerMillion) || rate.outputPerMillion < 0 ||
      typeof rate.currency !== 'string' || !/^[A-Z]{3}$/.test(rate.currency)) return unknownTaskCost();
    if (currency !== null && currency !== rate.currency) return unknownTaskCost();
    currency = rate.currency;
    total += (usage.inputTokens! / 1000000) * rate.inputPerMillion + (usage.outputTokens! / 1000000) * rate.outputPerMillion;
    if (!Number.isFinite(total)) return unknownTaskCost();
  }
  return { estimatedCost: total, currency, costSource: 'estimated' };
}
