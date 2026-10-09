import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/auth/current-user";
import { getUploadProgress, getUploads } from "@/services/queries";
import { effectiveSettings } from "@/services/cadence/actions";
import { localDate } from "@/services/cadence/calendar";
import { AutoRefresh, UploadWizard } from "@/components/UploadWizard";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";

function Progress({ label, done, total, failed }: { label: string; done: number; total: number; failed?: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          {done}/{total}
          {failed ? <span className="text-danger"> · {failed} failed</span> : null}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-black/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

async function Uploads() {
  const user = await getCurrentUser();
  const settings = effectiveSettings({ settings: user.settings });
  const uploads = await getUploads(user.id);
  const progress = (await Promise.all(uploads.slice(0, 5).map((u) => getUploadProgress(user.id, u.id)))).filter((p) => p !== null);
  const running = uploads.some((u) => u.status === "ingested" || u.status === "researching");

  return (
    <div className="space-y-8">
      <UploadWizard defaultDate={localDate(new Date(), settings.timezone)} defaultTime={settings.day1SendTime} />
      <AutoRefresh active={running} />
      {progress.length > 0 && (
        <section aria-labelledby="recent">
          <h2 id="recent" className="mb-2 text-sm font-semibold">
            Recent uploads
          </h2>
          <div className="space-y-3">
            {progress.map((p) => (
              <Card key={p.upload.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="max-w-md truncate text-sm font-medium" title={p.upload.source}>
                    {p.upload.source}
                  </span>
                  <Badge tone={p.upload.status === "drafted" ? "ok" : p.upload.status === "failed" ? "danger" : "accent"}>
                    {{ ingested: "Queued", researching: "Researching", drafted: "Drafts ready", failed: "Failed" }[p.upload.status] ?? p.upload.status}
                  </Badge>
                  <span className="ml-auto text-xs text-muted">
                    {p.upload.readyRows} ready · {p.upload.skippedRows.length} skipped · {p.upload.createdAt.toLocaleString()}
                  </span>
                </div>
                {p.upload.error && <p className="mt-2 text-sm text-danger">{p.upload.error}</p>}
                {p.total > 0 && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Progress label="Companies researched" done={p.companies.ready} total={p.companies.total} failed={p.companies.failed} />
                    <Progress label="People researched" done={p.people.ready} total={p.people.total} failed={p.people.failed} />
                    <Progress label="Day 1 drafts" done={p.drafts.ready} total={p.total} failed={p.drafts.failed} />
                  </div>
                )}
                {p.upload.status === "drafted" && (
                  <Link href="/" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
                    Review Day 1 emails →
                  </Link>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <>
      <PageHeader
        title="Upload call list"
        description="Add the prospects you've made first calls to. We research each industry, company and person once, then draft Day 1 emails for your review."
      />
      <Suspense fallback={<Skeleton className="h-72" />}>
        <Uploads />
      </Suspense>
    </>
  );
}
