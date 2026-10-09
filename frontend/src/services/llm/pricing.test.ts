import { describe, expect, it } from "vitest";
import { costUsd, usageFromApi } from "./pricing";

describe("cost tracker pricing", () => {
  it("prices a Sonnet research call with cache and web search", () => {
    const usage = usageFromApi({
      input_tokens: 20_000,
      output_tokens: 1_500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 4_000,
      cache_creation: { ephemeral_5m_input_tokens: 4_000, ephemeral_1h_input_tokens: 0 },
      server_tool_use: { web_search_requests: 5, web_fetch_requests: 2 },
    });
    // 20k*$2/M + 4k*$2.5/M + 10k*$0.2/M + 1.5k*$10/M + 5*$0.01
    expect(costUsd("claude-sonnet-5", usage)).toBeCloseTo(0.04 + 0.01 + 0.002 + 0.015 + 0.05, 6);
    expect(usage.webFetches).toBe(2);
  });

  it("halves token cost for batch requests but not web search", () => {
    const usage = usageFromApi({ input_tokens: 1_000_000, output_tokens: 0, server_tool_use: { web_search_requests: 1 } });
    expect(costUsd("claude-sonnet-5", usage, { batch: true })).toBeCloseTo(1 + 0.01, 6);
  });

  it("falls back to cache_creation_input_tokens when the breakdown is missing", () => {
    const usage = usageFromApi({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 });
    expect(costUsd("claude-haiku-4-5", usage)).toBeCloseTo(1.25, 6);
  });

  it("rejects unknown models instead of silently costing $0", () => {
    expect(() => costUsd("unknown-model", usageFromApi({ input_tokens: 1, output_tokens: 1 }))).toThrow();
  });
});
