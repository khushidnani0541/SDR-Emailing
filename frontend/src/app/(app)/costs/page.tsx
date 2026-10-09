import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/auth/current-user";
import { getCosts } from "@/services/queries";
import { DailyCostChart } from "@/components/DailyCostChart";
import { DEFAULT_TIMEZONE, localDate, zonedTime } from "@/services/cadence/calendar";
import { Card, PageHeader, Skeleton, Stat, cx } from "@/components/ui";

const RANGES = { today: 1, "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGES;

const STAGE_LABEL: Record<string, string> = {
  classify: "Industry classification",
  industry: "Industry briefs",
  company: "Company research",
  person: "Person research",
  draft: "Email drafting",
  template: "Template parsing",
};

const usd = (n: number) => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const num = (n: number) => n.toLocaleString();

function shiftDate(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** One entry per local day in range, including days with no usage. */
function fillDays(rows: { day: string; cost: number; calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }[], firstDay: string, days: number) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = shiftDate(firstDay, i);
    const r = byDay.get(d);
    return { day: d, cost: r?.cost ?? 0, calls: r?.calls ?? 0, tokens: r ? r.input + r.output + r.cacheRead + r.cacheWrite : 0 };
  });
}

async function Costs({ searchParams }: { searchParams: Promise<{ range?: string; scope?: string }> }) {
  const user = await getCurrentUser();
  const sp = await searchParams;
  const range: RangeKey = sp.range && sp.range in RANGES ? (sp.range as RangeKey) : "today";
  const mine = sp.scope !== "all";
  const days = RANGES[range];
  // Day boundaries follow the SDR's timezone, matching the Today page.
  const timeZone = user.settings.timezone ?? DEFAULT_TIMEZONE;
  const firstDay = shiftDate(localDate(new Date(), timeZone), -(days - 1));
  const data = await getCosts({ from: zonedTime(firstDay, "00:00", timeZone), to: new Date(), timeZone }, mine ? user.id : undefined);
  const o = data.overall;
  const totalInput = o.input + o.cacheRead + o.cacheWrite;
  const cacheRate = totalInput ? o.cacheRead / totalInput : 0;
  const reused = data.hits.reduce((s, h) => s + h.hits, 0);
  const href = (r: RangeKey, scope: string) => `/costs?range=${r}&scope=${scope}`;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(Object.keys(RANGES) as RangeKey[]).map((r) => (
          <Link key={r} href={href(r, mine ? "me" : "all")} className={cx("rounded-md px-2.5 py-1 text-sm", r === range ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-black/5")}>
            {r === "today" ? "Today" : `Last ${RANGES[r]} days`}
          </Link>
        ))}
        <span className="mx-2 h-5 w-px bg-line" aria-hidden />
        {(["me", "all"] as const).map((s) => (
          <Link key={s} href={href(range, s)} className={cx("rounded-md px-2.5 py-1 text-sm", (s === "me") === mine ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-black/5")}>
            {s === "me" ? "My usage" : "All SDRs"}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Model cost" value={usd(o.cost)} hint={`${num(o.calls)} model calls · ${num(o.webSearches)} web searches`} />
        <Stat label="Tokens" value={num(totalInput + o.output)} hint={`${num(totalInput)} in · ${num(o.output)} out`} />
        <Stat label="Prompt cache hit rate" value={`${Math.round(cacheRate * 100)}%`} hint={`${num(o.cacheRead)} tokens read from cache`} />
        <Stat
          label="Cost per email"
          value={data.drafted ? usd(o.cost / data.drafted) : "—"}
          hint={`${data.drafted} drafted · ${data.sent} sent · ${data.prospects ? usd(o.cost / data.prospects) : "—"} per prospect`}
        />
      </div>

      {days > 1 && (
        <Card className="mt-6 p-5">
          <h2 className="mb-4 text-sm font-semibold">Daily model cost</h2>
          <DailyCostChart points={fillDays(data.byDay, firstDay, days)} />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="px-4 pt-4 text-sm font-semibold">By step</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Step</th>
                <th className="px-4 py-2 text-right font-medium">Calls</th>
                <th className="px-4 py-2 text-right font-medium">Reused</th>
                <th className="px-4 py-2 text-right font-medium">Tokens</th>
                <th className="px-4 py-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {data.byStage.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No usage yet
                  </td>
                </tr>
              )}
              {data.byStage.map((s) => (
                <tr key={s.stage}>
                  <td className="px-4 py-2">{STAGE_LABEL[s.stage] ?? s.stage}</td>
                  <td className="px-4 py-2 text-right">{num(s.calls)}</td>
                  <td className="px-4 py-2 text-right text-muted">{num(data.hits.find((h) => h.stage === s.stage)?.hits ?? 0)}</td>
                  <td className="px-4 py-2 text-right">{num(s.input + s.output + s.cacheRead + s.cacheWrite)}</td>
                  <td className="px-4 py-2 text-right font-medium">{usd(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">
            &ldquo;Reused&rdquo; counts research served from cache instead of re-run: {num(reused)} in this range.
          </p>
        </Card>

        <div className="space-y-6">
          <Card className="overflow-x-auto">
            <h2 className="px-4 pt-4 text-sm font-semibold">By model</h2>
            <table className="mt-2 w-full text-sm">
              <tbody className="divide-y divide-line tabular-nums">
                {data.byModel.map((m) => (
                  <tr key={`${m.model}-${m.batch}`}>
                    <td className="px-4 py-2">
                      {m.model}
                      {m.batch && <span className="text-muted"> · batch (50% off)</span>}
                    </td>
                    <td className="px-4 py-2 text-right">{num(m.calls)} calls</td>
                    <td className="px-4 py-2 text-right font-medium">{usd(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {!mine && (
            <Card className="overflow-x-auto">
              <h2 className="px-4 pt-4 text-sm font-semibold">By SDR</h2>
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-line tabular-nums">
                  {data.byUser.map((u) => (
                    <tr key={u.sdr}>
                      <td className="px-4 py-2">{u.sdr}</td>
                      <td className="px-4 py-2 text-right">{num(u.calls)} calls</td>
                      <td className="px-4 py-2 text-right font-medium">{usd(u.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>

      {days > 1 && data.byDay.length > 0 && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted">Daily figures as a table</summary>
          <Card className="mt-2 overflow-x-auto">
            <table className="w-full tabular-nums">
              <tbody className="divide-y divide-line">
                {data.byDay.map((d) => (
                  <tr key={d.day}>
                    <td className="px-4 py-1.5">{d.day}</td>
                    <td className="px-4 py-1.5 text-right">{num(d.calls)} calls</td>
                    <td className="px-4 py-1.5 text-right">{num(d.input + d.output + d.cacheRead + d.cacheWrite)} tokens</td>
                    <td className="px-4 py-1.5 text-right font-medium">{usd(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </details>
      )}
    </>
  );
}

export default function CostsPage({ searchParams }: PageProps<"/costs">) {
  return (
    <>
      <PageHeader
        title="Costs"
        description="Every model call is logged with its tokens, web searches and list-price cost. Research reused from cache costs nothing."
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Costs searchParams={searchParams as Promise<{ range?: string; scope?: string }>} />
      </Suspense>
    </>
  );
}
