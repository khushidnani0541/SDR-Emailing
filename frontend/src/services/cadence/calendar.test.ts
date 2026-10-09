import { describe, expect, it } from "vitest";
import { addBusinessDays, cadenceDate, cadenceDayOn, localDate, staggeredTimes, zonedTime } from "./calendar";

describe("business-day cadence", () => {
  // 2026-10-05 is a Monday.
  it("maps Day 4/7/12 onto business days from a Monday", () => {
    expect(cadenceDate("2026-10-05", 1)).toBe("2026-10-05");
    expect(cadenceDate("2026-10-05", 4)).toBe("2026-10-08"); // Thu
    expect(cadenceDate("2026-10-05", 7)).toBe("2026-10-13"); // next Tue
    expect(cadenceDate("2026-10-05", 12)).toBe("2026-10-20"); // Tue week after
  });

  it("skips weekends and holidays", () => {
    expect(addBusinessDays("2026-10-09", 1)).toBe("2026-10-12"); // Fri -> Mon
    expect(addBusinessDays("2026-10-09", 1, ["2026-10-12"])).toBe("2026-10-13");
  });

  it("finds the cadence day for a given date", () => {
    expect(cadenceDayOn("2026-10-05", "2026-10-05")).toBe(1);
    expect(cadenceDayOn("2026-10-05", "2026-10-08")).toBe(4);
    expect(cadenceDayOn("2026-10-05", "2026-10-13")).toBe(7);
    expect(cadenceDayOn("2026-10-05", "2026-10-10")).toBeNull(); // Saturday
    expect(cadenceDayOn("2026-10-05", "2026-10-01")).toBeNull();
  });

  it("round-trips the cadence day and date", () => {
    for (const day of [3, 4, 7, 9, 12]) {
      expect(cadenceDayOn("2026-10-07", cadenceDate("2026-10-07", day))).toBe(day);
    }
  });
});

describe("timezones", () => {
  it("converts IST local time to UTC", () => {
    expect(zonedTime("2026-10-09", "09:30", "Asia/Kolkata").toISOString()).toBe("2026-10-09T04:00:00.000Z");
  });
  it("handles DST zones", () => {
    expect(zonedTime("2026-07-01", "09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTime("2026-12-01", "09:00", "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("computes the local date", () => {
    expect(localDate(new Date("2026-10-09T20:00:00Z"), "Asia/Kolkata")).toBe("2026-10-10");
  });
});

describe("staggered sends", () => {
  it("spreads sends across the window", () => {
    const start = new Date("2026-10-09T04:00:00Z");
    const times = staggeredTimes(start, 3, 30, () => 0.5);
    expect(times.map((t) => t.toISOString())).toEqual([
      "2026-10-09T04:00:00.000Z",
      "2026-10-09T04:15:00.000Z",
      "2026-10-09T04:30:00.000Z",
    ]);
  });
});
