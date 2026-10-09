import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/auth/current-user";
import { getTodayData } from "@/services/queries";
import { ReviewQueue } from "@/components/ReviewQueue";
import { CallList } from "@/components/CallList";
import { RunMorningButton } from "@/components/RunMorningButton";
import { Alert, PageHeader, Skeleton } from "@/components/ui";

async function Today() {
  const user = await getCurrentUser();
  const data = await getTodayData(user.id);
  const readyCount = data.emails.filter((e) => e.status === "pending_review").length;
  const ranToday = data.latestRun?.kind === "morning" && data.latestRun.runDate === data.today;

  return (
    <>
      <PageHeader
        title="Today"
        description={
          <>
            {new Date(`${data.today}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
            {readyCount} email{readyCount === 1 ? "" : "s"} to review · {data.calls.length} call{data.calls.length === 1 ? "" : "s"}
          </>
        }
        actions={!ranToday ? <RunMorningButton disabled={!data.gmailConnected} /> : undefined}
      />
      <div className="space-y-8">
        {!data.gmailConnected && (
          <Alert tone="warn">
            Your Gmail isn&apos;t connected yet. <Link href="/settings?connect=1" className="font-medium underline">Connect it in Settings</Link> to queue emails.
          </Alert>
        )}
        {data.latestRun?.status === "failed" && <Alert tone="danger">The last {data.latestRun.kind} run failed: {data.latestRun.error}</Alert>}

        <section aria-labelledby="emails-heading">
          <h2 id="emails-heading" className="sr-only">
            Emails
          </h2>
          <ReviewQueue
            emails={data.emails}
            defaultSendTime={data.settings.defaultSendTime}
            defaultSpread={data.settings.spreadMinutes}
            gmailConnected={data.gmailConnected}
            expiredIds={data.expiredIds}
          />
        </section>

        <section aria-labelledby="calls-heading">
          <h2 id="calls-heading" className="mb-2 text-sm font-semibold">
            Calls <span className="font-normal text-muted">· Day 3, 9 and 12 follow-up calls</span>
          </h2>
          <CallList calls={data.calls} />
        </section>
      </div>
    </>
  );
}

export default function TodayPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      }
    >
      <Today />
    </Suspense>
  );
}
