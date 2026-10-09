import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/auth/current-user";
import { getProspects } from "@/services/queries";
import { industryDef } from "@/services/research/taxonomy";
import { Badge, Card, EmptyState, PageHeader, Skeleton, cx } from "@/components/ui";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "accent" | "neutral"> = {
  active: "accent",
  researching: "neutral",
  replied: "ok",
  meeting_booked: "ok",
  bounced: "danger",
  not_interested: "warn",
  completed: "neutral",
  stopped: "neutral",
};

const FILTERS = ["all", "active", "replied", "meeting_booked", "bounced", "completed", "stopped"];

async function ProspectTable({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser();
  const { status } = await searchParams;
  const filter = status && FILTERS.includes(status) && status !== "all" ? status : undefined;
  const rows = await getProspects(user.id, filter);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/prospects" : `/prospects?status=${f}`}
            className={cx(
              "rounded-md px-2.5 py-1 text-sm",
              (filter ?? "all") === f ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-black/5",
            )}
          >
            {f.replace("_", " ")}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No prospects here yet">
          <Link href="/upload" className="text-accent hover:underline">
            Upload a call list
          </Link>{" "}
          to start a cadence.
        </EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-medium">Prospect</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Industry</th>
                <th className="px-4 py-2 font-medium">Day 1</th>
                <th className="px-4 py-2 font-medium">Sent</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ prospect: p, industryKey, sent }) => (
                <tr key={p.id} className="hover:bg-bg">
                  <td className="px-4 py-2">
                    <Link href={`/prospects/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-muted">{p.title}</div>
                  </td>
                  <td className="px-4 py-2">{p.companyName}</td>
                  <td className="px-4 py-2 text-muted">{industryKey ? industryDef(industryKey).label : "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-muted">{p.day1Date ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{sent}/4</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status.replace("_", " ")}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

export default function ProspectsPage({ searchParams }: PageProps<"/prospects">) {
  return (
    <>
      <PageHeader title="Prospects" description="Everyone in a cadence, with their research and progress." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ProspectTable searchParams={searchParams as Promise<{ status?: string }>} />
      </Suspense>
    </>
  );
}
