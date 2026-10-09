import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {}, schema: {} }));

describe("morning run scheduling", () => {
  // Day 1 on Monday 2026-10-05 -> Day 4 = Thu 10-08, Day 7 = Tue 10-13, Day 12 = Tue 10-20.
  it("finds the next due follow-up", async () => {
    const { nextDueDay } = await import("./morning");
    expect(nextDueDay("2026-10-05", [1], "2026-10-07", [])).toBeNull();
    expect(nextDueDay("2026-10-05", [1], "2026-10-08", [])).toBe(4);
    expect(nextDueDay("2026-10-05", [1, 4], "2026-10-12", [])).toBeNull();
    expect(nextDueDay("2026-10-05", [1, 4], "2026-10-13", [])).toBe(7);
    expect(nextDueDay("2026-10-05", [1, 4, 7, 12], "2026-10-30", [])).toBeNull();
  });

  it("catches up a missed day instead of skipping it", async () => {
    const { nextDueDay } = await import("./morning");
    // Day 4 was never drafted (e.g. the worker was down); on Day 5 it is still due.
    expect(nextDueDay("2026-10-05", [1], "2026-10-09", [])).toBe(4);
  });

  it("respects holidays", async () => {
    const { nextDueDay } = await import("./morning");
    expect(nextDueDay("2026-10-05", [1], "2026-10-08", ["2026-10-06"])).toBeNull();
    expect(nextDueDay("2026-10-05", [1], "2026-10-09", ["2026-10-06"])).toBe(4);
  });
});
