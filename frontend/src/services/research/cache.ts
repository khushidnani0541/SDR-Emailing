import { db, schema } from "@/db";
import type { CallCtx } from "@/services/llm/tracked";

export const TTL_DAYS = { industry: 30, company: 30, person: 60 } as const;

export function isFresh(researchedAt: Date | null | undefined, days: number): boolean {
  return !!researchedAt && Date.now() - researchedAt.getTime() < days * 86_400_000;
}

/** Records research avoided by reusing a cached result (shown on the cost dashboard). */
export async function recordCacheHit(ctx: CallCtx, key: string): Promise<void> {
  try {
    await db.insert(schema.cacheHits).values({ runId: ctx.runId ?? null, userId: ctx.userId ?? null, stage: ctx.stage, key });
  } catch (err) {
    console.error("[cache] failed to record hit", err);
  }
}

// In-process single-flight: concurrent requests for the same research key share one call.
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
