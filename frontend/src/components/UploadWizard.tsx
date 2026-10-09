"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { uploadProspectsAction, type ActionResult, type UploadSummary } from "@/app/actions";
import { Alert, Button, Card, Field, inputClass } from "./ui";

export function UploadWizard({ defaultDate, defaultTime }: { defaultDate: string; defaultTime: string }) {
  const [state, action, pending] = useActionState<ActionResult<UploadSummary> | null, FormData>(uploadProspectsAction, null);
  const [mode, setMode] = useState<"sheet" | "file">("sheet");

  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        <div role="tablist" aria-label="Source" className="inline-flex rounded-md border border-line p-0.5 text-sm">
          {(["sheet", "file"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 ${mode === m ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}
            >
              {m === "sheet" ? "Google Sheet link" : "CSV / Excel file"}
            </button>
          ))}
        </div>

        {mode === "sheet" ? (
          <Field label="Google Sheet link" hint="Needs columns for Name, Title, Company, LinkedIn and Email. Optional: Call notes.">
            <input name="sheetUrl" type="url" className={inputClass} placeholder="https://docs.google.com/spreadsheets/d/…" required />
          </Field>
        ) : (
          <Field label="File" hint="Same columns as the sheet. First row must be the header.">
            <input name="file" type="file" accept=".csv,.xlsx" className="block text-sm" required />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day 1 send date">
            <input name="day1Date" type="date" className={inputClass} defaultValue={defaultDate} required />
          </Field>
          <Field label="Day 1 send time" hint="Your timezone. Emails are spread out from this time after you approve them.">
            <input name="day1Time" type="time" className={inputClass} defaultValue={defaultTime} required />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="primary" type="submit" disabled={pending}>
            {pending ? "Reading sheet…" : "Start research"}
          </Button>
          <span className="text-xs text-muted">Prospects without an email address are skipped automatically.</span>
        </div>
      </form>

      {state && !state.ok && (
        <div className="mt-4">
          <Alert tone="danger">{state.error}</Alert>
        </div>
      )}
      {state?.ok && state.data && <UploadSummaryView summary={state.data} />}
    </Card>
  );
}

function UploadSummaryView({ summary }: { summary: UploadSummary }) {
  return (
    <div className="mt-5 space-y-3 border-t border-line pt-4">
      <Alert tone={summary.ready ? "ok" : "warn"}>
        {summary.ready
          ? `${summary.ready} prospect${summary.ready === 1 ? "" : "s"} queued for research. Day 1 drafts will appear on Today for review.`
          : "No prospects were ready to start."}
      </Alert>
      {summary.skipped.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            {summary.skipped.length} row{summary.skipped.length === 1 ? "" : "s"} skipped
          </summary>
          <ul className="mt-2 space-y-1">
            {summary.skipped.map((s) => (
              <li key={s.row} className="text-xs">
                <span className="text-muted">Row {s.row}:</span> {s.name || "(no name)"}
                {s.company ? `, ${s.company}` : ""} — {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Refreshes the server-rendered progress while any upload is still running. */
export function AutoRefresh({ active, intervalMs = 5000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
