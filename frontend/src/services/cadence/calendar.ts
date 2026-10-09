// Cadence date math. Dates are ISO "YYYY-MM-DD" strings in the SDR's local timezone.

export const EMAIL_DAYS = [1, 4, 7, 12] as const;
export const CALL_DAYS = [1, 3, 9, 12] as const;
export const LINKEDIN_DAY = 6; // LinkedIn connection request (manual SDR task)
export type EmailDay = (typeof EMAIL_DAYS)[number];

// Prospects are US-based: cadence days and send times follow US Eastern time by default.
export const DEFAULT_TIMEZONE = "America/New_York";

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isBusinessDay(iso: string, holidays: readonly string[] = []): boolean {
  const dow = parseIso(iso).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.includes(iso);
}

/** Moves forward `n` business days from `startIso` (n = 0 returns the start date). */
export function addBusinessDays(startIso: string, n: number, holidays: readonly string[] = []): string {
  const d = parseIso(startIso);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(toIso(d), holidays)) remaining--;
  }
  return toIso(d);
}

/** Calendar date of cadence day `day` (Day 1 = the Day 1 send date). */
export function cadenceDate(day1Iso: string, day: number, holidays: readonly string[] = []): string {
  return addBusinessDays(day1Iso, day - 1, holidays);
}

/** Which cadence day `todayIso` is for a prospect whose Day 1 was `day1Iso`, or null if not a business day. */
export function cadenceDayOn(day1Iso: string, todayIso: string, holidays: readonly string[] = []): number | null {
  if (todayIso < day1Iso) return null;
  if (todayIso === day1Iso) return 1;
  if (!isBusinessDay(todayIso, holidays)) return null;
  let day = 1;
  let cursor = day1Iso;
  while (cursor < todayIso) {
    cursor = addBusinessDays(cursor, 1, holidays);
    day++;
  }
  return cursor === todayIso ? day : null;
}

/** Today's date in a timezone. */
export function localDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - at.getTime()) / 60_000;
}

/** Converts a local date + "HH:mm" in `timeZone` to a UTC instant. */
export function zonedTime(dateIso: string, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = dateIso.split("-").map(Number);
  const guess = new Date(Date.UTC(y, mo - 1, d, h, m));
  const offset = tzOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - offset * 60_000);
  // Re-check once in case the offset differs at the target instant (DST edges).
  const offset2 = tzOffsetMinutes(first, timeZone);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60_000);
}

/**
 * Staggered send times: first email at `start`, the rest spread evenly across `spreadMinutes`
 * with small jitter so sends don't look machine-generated.
 */
export function staggeredTimes(start: Date, count: number, spreadMinutes: number, rand: () => number = Math.random): Date[] {
  if (count <= 0) return [];
  const step = count > 1 ? (spreadMinutes * 60_000) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => {
    const jitter = i === 0 || step === 0 ? 0 : (rand() - 0.5) * Math.min(step, 60_000);
    return new Date(start.getTime() + i * step + jitter);
  });
}
