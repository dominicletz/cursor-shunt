export interface UsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "totalTokens",
] as const;

export function normalizeUsage(value: unknown): UsageSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const numbers = Object.fromEntries(
    USAGE_FIELDS.map((field) => [field, record[field]]),
  ) as Record<(typeof USAGE_FIELDS)[number], unknown>;
  if (USAGE_FIELDS.some((field) => typeof numbers[field] !== "number" || !Number.isFinite(numbers[field]))) {
    return undefined;
  }

  const reasoningTokens = record.reasoningTokens;
  return {
    inputTokens: numbers.inputTokens as number,
    outputTokens: numbers.outputTokens as number,
    cacheReadTokens: numbers.cacheReadTokens as number,
    cacheWriteTokens: numbers.cacheWriteTokens as number,
    totalTokens: numbers.totalTokens as number,
    ...(typeof reasoningTokens === "number" && Number.isFinite(reasoningTokens) ? { reasoningTokens } : {}),
  };
}

export function zeroUsage(): UsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  };
}

export function addUsage(left: UsageSnapshot, right: UsageSnapshot): UsageSnapshot {
  const hasReasoning = left.reasoningTokens !== undefined || right.reasoningTokens !== undefined;
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    ...(hasReasoning
      ? { reasoningTokens: (left.reasoningTokens ?? 0) + (right.reasoningTokens ?? 0) }
      : {}),
  };
}

export function sumUsage(usages: readonly UsageSnapshot[]): UsageSnapshot {
  return usages.reduce(addUsage, zeroUsage());
}

export function meanUsage(usages: readonly UsageSnapshot[]): UsageSnapshot {
  if (usages.length === 0) return zeroUsage();
  const total = sumUsage(usages);
  const hasReasoning = total.reasoningTokens !== undefined;
  return {
    inputTokens: total.inputTokens / usages.length,
    outputTokens: total.outputTokens / usages.length,
    cacheReadTokens: total.cacheReadTokens / usages.length,
    cacheWriteTokens: total.cacheWriteTokens / usages.length,
    totalTokens: total.totalTokens / usages.length,
    ...(hasReasoning ? { reasoningTokens: (total.reasoningTokens ?? 0) / usages.length } : {}),
  };
}

export function combineUsage(parent: UsageSnapshot, worker: UsageSnapshot): UsageSnapshot {
  return addUsage(parent, worker);
}

export function percentSavings(baselineTokens: number, shuntTokens: number): number | null {
  if (baselineTokens <= 0) return null;
  return ((baselineTokens - shuntTokens) / baselineTokens) * 100;
}
