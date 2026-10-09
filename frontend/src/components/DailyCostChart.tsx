"use client";

import { useState } from "react";

export type DayPoint = { day: string; cost: number; calls: number; tokens: number };

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** Single-series bar chart: one hue, thin bars with 2px gaps, recessive axis, per-bar tooltip. */
export function DailyCostChart({ points }: { points: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.cost), 0.0001);
  const ticks = [max, max / 2, 0];

  if (!points.length) return <p className="py-10 text-center text-sm text-muted">No model usage in this range.</p>;

  return (
    <div className="relative">
      <div className="flex h-48 gap-3">
        <div className="flex w-14 flex-col justify-between text-right text-[11px] tabular-nums text-muted" aria-hidden>
          {ticks.map((t, i) => (
            <span key={i}>{usd(t)}</span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]" role="list" aria-label="Daily model cost">
            {points.map((p, i) => (
              <div
                key={p.day}
                role="listitem"
                tabIndex={0}
                aria-label={`${p.day}: ${usd(p.cost)} across ${p.calls} model calls`}
                className="group relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <div
                  className={`w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity ${hover !== null && hover !== i ? "opacity-50" : ""}`}
                  style={{ height: `${Math.max((p.cost / max) * 100, p.cost > 0 ? 1.5 : 0)}%` }}
                />
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-2 w-max rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md">
                    <p className="font-medium">{new Date(`${p.day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</p>
                    <p className="tabular-nums">{usd(p.cost)}</p>
                    <p className="tabular-nums text-muted">
                      {p.calls} calls · {p.tokens.toLocaleString()} tokens
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-[4.25rem] mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        <span>{points[0].day.slice(5)}</span>
        {points.length > 1 && <span>{points[points.length - 1].day.slice(5)}</span>}
      </div>
    </div>
  );
}
