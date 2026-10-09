import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/auth/current-user";
import { getProspectResearch } from "@/services/queries";
import { industryDef } from "@/services/research/taxonomy";
import { StopProspect } from "@/components/StopProspect";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="space-y-3 text-sm">{children}</div>
    </Card>
  );
}

function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Source({ url }: { url: string | null }) {
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
      {host}
    </a>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  const data = await getProspectResearch(user.id, id);
  if (!data) notFound();
  const { prospect: p, company, person, industry, emails, calls } = data;
  const cr = company?.research;
  const pr = person?.research;
  const brief = industry?.brief;

  return (
    <>
      <PageHeader
        title={p.name}
        description={
          <>
            {p.title ? `${p.title} · ` : ""}
            {p.companyName} · {p.email}
            {p.linkedinUrl && (
              <>
                {" · "}
                <a href={p.linkedinUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  LinkedIn
                </a>
              </>
            )}
          </>
        }
        actions={p.status === "active" ? <StopProspect prospectId={p.id} /> : <Badge>{p.status.replace("_", " ")}{p.stopReason ? ` · ${p.stopReason}` : ""}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Section title="Company research" aside={company?.researchedAt && <span className="text-xs text-muted">Researched {company.researchedAt.toLocaleDateString()}</span>}>
            {!cr ? (
              <p className="text-muted">{company?.status === "failed" ? `Research failed: ${company.error}` : "Not researched yet."}</p>
            ) : (
              <dl className="space-y-2">
                <KV k="About">{cr.description}</KV>
                <KV k="Industry">{industryDef(cr.confirmedIndustryKey).label}</KV>
                <KV k="Size">
                  {cr.size.employees ?? "?"} employees · revenue {cr.size.revenue ?? "?"} · {cr.size.band}
                </KV>
                <KV k="Locations">
                  {cr.locations.hq ?? "?"}
                  {cr.locations.plants.length > 0 && <span className="text-muted"> · plants: {cr.locations.plants.join(", ")}</span>}
                </KV>
                <KV k="Likely equipment">{cr.likelyMachinesAndProcesses.join(", ")}</KV>
                <KV k="Digital maturity">
                  {cr.digitalMaturity.level}/5 — {cr.digitalMaturity.evidence}
                </KV>
                <KV k="Where we land first">
                  <span className="font-medium">{cr.firstValueWedge.offering}</span> — {cr.firstValueWedge.why}{" "}
                  <span className="text-muted">(buyer: {cr.firstValueWedge.likelyBuyer})</span>
                </KV>
                <KV k="Signals">
                  {cr.signals.length === 0 ? (
                    <span className="text-muted">None found</span>
                  ) : (
                    <ul className="space-y-1.5">
                      {cr.signals.map((s, i) => (
                        <li key={i}>
                          <Badge tone="accent">{s.type.replaceAll("_", " ")}</Badge> {s.summary}{" "}
                          {s.date && <span className="text-xs text-muted">({s.date})</span>} <Source url={s.sourceUrl} />
                        </li>
                      ))}
                    </ul>
                  )}
                </KV>
              </dl>
            )}
          </Section>

          <Section
            title="Person research"
            aside={pr && <Badge tone={pr.identityConfidence === "low" ? "warn" : "neutral"}>identity: {pr.identityConfidence}</Badge>}
          >
            {!pr ? (
              <p className="text-muted">{person?.status === "failed" ? `Research failed: ${person.error}` : "Not researched yet."}</p>
            ) : (
              <dl className="space-y-2">
                <KV k="Role">
                  {pr.currentRole}
                  {pr.tenure && <span className="text-muted"> · {pr.tenure}</span>}
                </KV>
                <KV k="Background">{pr.background}</KV>
                <KV k="Responsibilities">{pr.responsibilities.join("; ")}</KV>
                <KV k="On their mind">
                  <ul className="space-y-1">
                    {pr.priorities.map((x, i) => (
                      <li key={i}>
                        {x.point} <Badge tone={x.basis === "sourced" ? "ok" : "neutral"}>{x.basis}</Badge> <Source url={x.sourceUrl} />
                      </li>
                    ))}
                  </ul>
                </KV>
                <KV k="Public mentions">
                  {pr.publicMentions.length === 0 ? (
                    <span className="text-muted">None found</span>
                  ) : (
                    <ul className="space-y-1">
                      {pr.publicMentions.map((m, i) => (
                        <li key={i}>
                          {m.summary} {m.date && <span className="text-xs text-muted">({m.date})</span>} <Source url={m.url} />
                        </li>
                      ))}
                    </ul>
                  )}
                </KV>
                <KV k="Hooks">{pr.personalizationHooks.join(" · ") || "—"}</KV>
                <KV k="Call opener">&ldquo;{pr.callOpener}&rdquo;</KV>
              </dl>
            )}
          </Section>

          {brief && (
            <Section title={`Industry brief · ${industry!.label}`} aside={<Link href="/industries" className="text-xs text-accent hover:underline">All industries</Link>}>
              <p>{brief.summary}</p>
              <p className="text-muted">Email-safe proof points:</p>
              <ul className="list-disc space-y-1 pl-5">
                {brief.emailSafe.proofPoints.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="space-y-5">
          <Section title="Cadence">
            <ol className="space-y-2">
              {[1, 3, 4, 6, 7, 9, 12].map((day) => {
                const email = emails.find((e) => e.day === day);
                const call = calls.find((c) => c.day === day);
                return (
                  <li key={day} className="flex flex-wrap items-baseline gap-2">
                    <span className="w-14 shrink-0 font-medium">Day {day}</span>
                    {email && (
                      <Badge tone={email.status === "sent" ? "ok" : email.status === "approved" ? "accent" : email.status === "pending_review" ? "warn" : "neutral"}>
                        email: {email.status.replace("_", " ")}
                      </Badge>
                    )}
                    {call && (
                      <Badge tone={call.status === "done" ? "ok" : "neutral"}>
                        {call.kind === "linkedin" ? "LinkedIn" : "call"}: {call.status === "done" ? (call.outcome ?? "done").replaceAll("_", " ") : call.dueDate}
                      </Badge>
                    )}
                    {!email && !call && [4, 7, 12].includes(day) && <span className="text-xs text-muted">email not drafted yet</span>}
                  </li>
                );
              })}
            </ol>
          </Section>

          {emails.filter((e) => e.body).map((e) => (
            <Section key={e.id} title={`Day ${e.day} email`} aside={<Badge>{e.status.replace("_", " ")}</Badge>}>
              {e.subject && <p className="font-medium">{e.subject}</p>}
              <p className="whitespace-pre-wrap text-sm">{e.body}</p>
              {e.rationale && <p className="text-xs text-muted">Why: {e.rationale}</p>}
            </Section>
          ))}
        </div>
      </div>
    </>
  );
}

export default function ProspectPage({ params }: PageProps<"/prospects/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <Detail params={params} />
    </Suspense>
  );
}
