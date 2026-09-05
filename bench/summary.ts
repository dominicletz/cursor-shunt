export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface UsageCost {
  rawCostCents: number;
  chargedCents: number;
}

function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

export function addTokenUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    reasoningTokens: addOptional(left.reasoningTokens, right.reasoningTokens),
  };
}

export function sumTokenUsage(usages: ReadonlyArray<TokenUsage | undefined>): TokenUsage | undefined {
  return usages.filter((usage): usage is TokenUsage => usage !== undefined).reduce<TokenUsage | undefined>(
    (total, usage) => (total ? addTokenUsage(total, usage) : { ...usage }),
    undefined,
  );
}

export function sumCost(costs: ReadonlyArray<UsageCost | undefined>): UsageCost | undefined {
  return costs.filter((cost): cost is UsageCost => cost !== undefined).reduce<UsageCost | undefined>(
    (total, cost) => (
      total
        ? {
            rawCostCents: total.rawCostCents + cost.rawCostCents,
            chargedCents: total.chargedCents + cost.chargedCents,
          }
        : { ...cost }
    ),
    undefined,
  );
}

export function percentageSavings(baselineTokens: number | undefined, shuntTokens: number | undefined): number | undefined {
  if (baselineTokens === undefined || shuntTokens === undefined || baselineTokens <= 0) return undefined;
  return Math.round(((baselineTokens - shuntTokens) / baselineTokens) * 10000) / 100;
}
