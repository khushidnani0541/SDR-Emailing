// USD list prices per 1M tokens (Anthropic first-party API, as of 2026-10).
// Update here if pricing changes; every cost figure in the app derives from this table.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2;
export const CACHE_READ_MULTIPLIER = 0.1;
export const BATCH_MULTIPLIER = 0.5;
export const WEB_SEARCH_USD_PER_CALL = 10 / 1000; // web fetch is not metered

export type UsageCounts = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearches: number;
  webFetches: number;
};

export function emptyUsage(): UsageCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
    webSearches: 0,
    webFetches: 0,
  };
}

export function addUsage(a: UsageCounts, b: UsageCounts): UsageCounts {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    webSearches: a.webSearches + b.webSearches,
    webFetches: a.webFetches + b.webFetches,
  };
}

/** Normalizes an Anthropic `usage` object into our counters. */
export function usageFromApi(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
  server_tool_use?: { web_search_requests: number; web_fetch_requests?: number } | null;
}): UsageCounts {
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = usage.cache_creation
    ? usage.cache_creation.ephemeral_5m_input_tokens
    : (usage.cache_creation_input_tokens ?? 0);
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    webFetches: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}

export function costUsd(model: string, u: UsageCounts, opts: { batch?: boolean } = {}): number {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`No pricing configured for model ${model}`);
  const perTok = (usdPerM: number) => usdPerM / 1_000_000;
  const tokenCost =
    u.inputTokens * perTok(price.input) +
    u.cacheWrite5mTokens * perTok(price.input * CACHE_WRITE_5M_MULTIPLIER) +
    u.cacheWrite1hTokens * perTok(price.input * CACHE_WRITE_1H_MULTIPLIER) +
    u.cacheReadTokens * perTok(price.input * CACHE_READ_MULTIPLIER) +
    u.outputTokens * perTok(price.output);
  const tokens = opts.batch ? tokenCost * BATCH_MULTIPLIER : tokenCost;
  return tokens + u.webSearches * WEB_SEARCH_USD_PER_CALL;
}
