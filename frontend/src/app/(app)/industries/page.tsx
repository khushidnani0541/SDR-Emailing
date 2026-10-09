import { Suspense } from "react";
import { getCurrentUser } from "@/auth/current-user";
import { getIndustries } from "@/services/queries";
import type { IndustryBrief } from "@/services/research/types";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";

const EVIDENCE_TONE = { delivered: "ok", poc: "accent", proposal_estimate: "neutral" } as const;

async function Industries() {
  await getCurrentUser();
  const rows = await getIndustries();
  if (!rows.length) {
    return <EmptyState title="No industry briefs yet">They are created from the Collateral Library the first time a prospect in that industry is uploaded.</EmptyState>;
  }
  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const brief = row.brief as IndustryBrief | null;
        return (
          <Card key={row.key} className="p-5">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                <span className="font-semibold">{row.label}</span>
                <Badge tone={row.status === "ready" ? "ok" : row.status === "failed" ? "danger" : "neutral"}>{row.status}</Badge>
                {row.researchedAt && <span className="ml-auto text-xs text-muted">Updated {row.researchedAt.toLocaleDateString()}</span>}
              </summary>
              {row.error && <p className="mt-2 text-sm text-danger">{row.error}</p>}
              {brief && (
                <div className="mt-4 space-y-5 text-sm">
                  <p>{brief.summary}</p>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Use cases</h3>
                    <ul className="space-y-2">
                      {brief.useCases.map((u, i) => (
                        <li key={i}>
                          <span className="font-medium">{u.title}</span> — {u.problem} <span className="text-muted">→ {u.faclonSolution}</span>
                          {u.offerings.length > 0 && <span className="ml-1 text-xs text-accent">[{u.offerings.join(", ")}]</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Typical results</h3>
                    <ul className="space-y-1.5">
                      {brief.typicalResults.map((r, i) => (
                        <li key={i}>
                          <Badge tone={EVIDENCE_TONE[r.evidence]}>{r.evidence.replace("_", " ")}</Badge> {r.result}
                          {r.client && <span className="text-muted"> · {r.client}</span>}
                          {r.sourceDocId && <code className="ml-1 text-xs text-muted">[{r.sourceDocId}]</code>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Clients</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {brief.relevantClients.map((c, i) => (
                        <Badge key={i} tone={c.status === "delivered" ? "ok" : c.status === "poc" ? "accent" : "neutral"}>
                          {c.name} · {c.status}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Collateral to share</h3>
                    <ul className="space-y-1">
                      {brief.collateral.map((c) => (
                        <li key={c.docId}>
                          <span className="font-medium">{c.title}</span> <Badge>{c.type}</Badge> <span className="text-muted">— {c.useFor}</span>{" "}
                          <code className="text-xs text-muted">{c.docId}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Email-safe proof points</h3>
                    <ul className="list-disc space-y-1 pl-5">
                      {brief.emailSafe.proofPoints.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </details>
          </Card>
        );
      })}
    </div>
  );
}

export default function IndustriesPage() {
  return (
    <>
      <PageHeader
        title="Industry briefs"
        description="One brief per industry, built from the Collateral Library and shared by every SDR. Refreshed every 30 days."
      />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Industries />
      </Suspense>
    </>
  );
}
