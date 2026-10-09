"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReviewEmail } from "@/services/queries";
import {
  approveEmailsAction,
  editEmailAction,
  regenerateEmailAction,
  rejectEmailAction,
  reviveExpiredAction,
} from "@/app/actions";
import { Alert, Badge, Button, Card, cx, inputClass, textareaClass } from "./ui";

const DAY_LABEL: Record<number, string> = { 1: "Day 1 · First touch", 4: "Day 4 · New angle", 7: "Day 7 · Resource", 12: "Day 12 · Close the loop" };

function statusBadge(e: ReviewEmail) {
  switch (e.status) {
    case "generating":
      return <Badge tone="accent">Drafting…</Badge>;
    case "failed":
      return <Badge tone="danger">Draft failed</Badge>;
    case "approved":
      return <Badge tone="ok">Queued in Gmail</Badge>;
    case "sent":
      return <Badge tone="ok">Sent</Badge>;
    case "rejected":
      return <Badge>Rejected</Badge>;
    case "cancelled":
      return <Badge>Cancelled</Badge>;
    default:
      return e.error ? <Badge tone="danger">Needs a fix</Badge> : e.warnings.length ? <Badge tone="warn">Check</Badge> : <Badge>Ready</Badge>;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ReviewQueue(props: {
  emails: ReviewEmail[];
  defaultSendTime: string;
  defaultSpread: number;
  gmailConnected: boolean;
  expiredIds: string[];
}) {
  const router = useRouter();
  const review = props.emails.filter((e) => ["pending_review", "generating", "failed"].includes(e.status));
  const queued = props.emails.filter((e) => ["approved", "sent"].includes(e.status));
  const approvable = review.filter((e) => e.status === "pending_review" && !e.error);

  const [selected, setSelected] = useState<Set<string>>(() => new Set(approvable.map((e) => e.id)));
  const [sendTime, setSendTime] = useState(props.defaultSendTime);
  const [spread, setSpread] = useState(props.defaultSpread);
  const [result, setResult] = useState<{ tone: "ok" | "danger" | "warn"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Keep selection in sync as drafts finish generating: newly ready emails are selected by default,
  // but anything the SDR deselected stays deselected.
  const approvableKey = approvable.map((e) => e.id).join(",");
  const seen = useRef<Set<string>>(new Set(approvable.map((e) => e.id)));
  useEffect(() => {
    const ids = new Set(approvableKey.split(",").filter(Boolean));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      for (const id of ids) {
        if (!seen.current.has(id)) {
          seen.current.add(id);
          next.add(id);
        }
      }
      return next;
    });
  }, [approvableKey]);

  // Poll while drafts are being generated.
  const generating = review.some((e) => e.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [generating, router]);

  const byDay = new Map<number, ReviewEmail[]>();
  for (const e of review) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const groups = [...byDay.entries()].sort(([a], [b]) => a - b);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function toggleGroup(ids: string[], on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }

  function approve() {
    setResult(null);
    startTransition(async () => {
      const res = await approveEmailsAction([...selected], sendTime, spread);
      if (!res.ok) return setResult({ tone: "danger", text: res.error });
      const { approved, failed, skipped } = res.data!;
      const parts = [`${approved} queued in Gmail`];
      if (skipped.length) parts.push(`${skipped.length} skipped (${skipped[0].reason}${skipped.length > 1 ? ", …" : ""})`);
      if (failed.length) parts.push(`${failed.length} failed (${failed[0].error})`);
      setResult({ tone: failed.length ? "danger" : skipped.length ? "warn" : "ok", text: parts.join(" · ") });
    });
  }

  const selectedCount = approvable.filter((e) => selected.has(e.id)).length;

  return (
    <div className="space-y-6">
      {props.expiredIds.length > 0 && (
        <Alert tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {props.expiredIds.length} email{props.expiredIds.length > 1 ? "s" : ""} from earlier days expired without review.
            </span>
            <Button
              disabled={pending}
              onClick={() => startTransition(async () => void (await reviveExpiredAction(props.expiredIds)))}
            >
              Move to today&apos;s review
            </Button>
          </div>
        </Alert>
      )}

      {review.length === 0 ? (
        <Card className="px-6 py-8 text-center text-sm text-muted">Nothing waiting for review.</Card>
      ) : (
        groups.map(([day, items]) => {
          const ids = items.filter((e) => approvable.some((a) => a.id === e.id)).map((e) => e.id);
          const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
          return (
            <section key={day} aria-labelledby={`day-${day}`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 id={`day-${day}`} className="text-sm font-semibold">
                  {DAY_LABEL[day] ?? `Day ${day}`} <span className="font-normal text-muted">· {items.length}</span>
                </h2>
                {ids.length > 0 && (
                  <button className="text-xs text-muted hover:text-ink" onClick={() => toggleGroup(ids, !allOn)}>
                    {allOn ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>
              <Card className="divide-y divide-line">
                {items.map((e) => (
                  <EmailRow
                    key={`${e.id}:${e.updatedAt}`}
                    email={e}
                    selectable={approvable.some((a) => a.id === e.id)}
                    selected={selected.has(e.id)}
                    onToggle={() => toggle(e.id)}
                  />
                ))}
              </Card>
            </section>
          );
        })
      )}

      {approvable.length > 0 && (
        <div className="sticky bottom-4 z-10">
          <Card className="flex flex-wrap items-center gap-3 px-4 py-3 shadow-lg shadow-black/5">
            <span className="text-sm font-medium">
              {selectedCount} of {approvable.length} selected
            </span>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
              Send at
              <input type="time" className={cx(inputClass, "w-28")} value={sendTime} onChange={(e) => setSendTime(e.target.value)} aria-label="Send time" />
            </label>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">
              spread over
              <input
                type="number"
                min={0}
                max={480}
                className={cx(inputClass, "w-20")}
                value={spread}
                onChange={(e) => setSpread(Number(e.target.value))}
                aria-label="Spread minutes"
              />
              min
            </label>
            <Button variant="primary" className="ml-auto" disabled={pending || selectedCount === 0 || !props.gmailConnected} onClick={approve}>
              {pending ? "Queuing…" : `Approve & queue ${selectedCount} in Gmail`}
            </Button>
            <span className="w-full text-xs text-muted">
              This time applies to follow-ups. Day 1 emails go out at the time set at upload, or at this time if that has passed.
            </span>
            {!props.gmailConnected && <span className="w-full text-xs text-warn">Connect Gmail in Settings to approve.</span>}
          </Card>
        </div>
      )}
      {result && <Alert tone={result.tone}>{result.text}</Alert>}

      {queued.length > 0 && (
        <section aria-labelledby="queued">
          <h2 id="queued" className="mb-2 text-sm font-semibold">
            Queued today <span className="font-normal text-muted">· {queued.length}</span>
          </h2>
          <Card className="divide-y divide-line">
            {queued.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <Badge>Day {e.day}</Badge>
                <span className="font-medium">{e.prospect.name}</span>
                <span className="text-muted">{e.prospect.company}</span>
                <span className="ml-auto flex items-center gap-2">
                  {e.error && <span className="text-xs text-warn">{e.error}</span>}
                  {e.status === "approved" && <span className="text-muted tabular-nums">{formatTime(e.scheduledFor)}</span>}
                  {statusBadge(e)}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function EmailRow({ email: e, selectable, selected, onToggle }: { email: ReviewEmail; selectable: boolean; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(e.subject ?? "");
  const [body, setBody] = useState(e.body ?? "");
  const [instruction, setInstruction] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = subject !== (e.subject ?? "") || body !== (e.body ?? "");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      if (!res.ok) setMsg(res.error ?? "Something went wrong");
    });

  const subjectLine = e.day === 1 ? e.subject : e.prospect.lastSubject ? `Re: ${e.prospect.lastSubject}` : "Reply in Day 1 thread";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[var(--accent)]"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          aria-label={`Select email to ${e.prospect.name}`}
        />
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{e.prospect.name}</span>
            <span className="text-sm text-muted">
              {e.prospect.title ? `${e.prospect.title} · ` : ""}
              {e.prospect.company}
            </span>
            {statusBadge(e)}
          </div>
          {e.body ? (
            <>
              <p className="mt-1 truncate text-sm">
                <span className="text-muted">{subjectLine} — </span>
                {e.body.replace(/\s+/g, " ").slice(0, 180)}
              </p>
              {e.rationale && !open && <p className="mt-0.5 truncate text-xs text-muted">Why: {e.rationale}</p>}
              {e.plannedSendAt && (
                <p className="mt-0.5 text-xs text-accent">
                  Sends {new Date(e.plannedSendAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (set at upload)
                </p>
              )}
            </>
          ) : e.status === "failed" ? (
            <p className="mt-1 text-sm text-danger">{e.error}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">Researching and drafting…</p>
          )}
        </button>
      </div>

      {(e.error || e.warnings.length > 0) && e.status !== "failed" && (
        <ul className="mt-2 ml-7 space-y-1">
          {e.error && <li className="text-xs text-danger">{e.error}</li>}
          {e.warnings.map((w) => (
            <li key={w} className="text-xs text-warn">
              {w}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 ml-7 space-y-3">
          {e.day === 1 ? (
            <input className={inputClass} value={subject} onChange={(ev) => setSubject(ev.target.value)} aria-label="Subject" />
          ) : (
            <p className="text-xs text-muted">Sent as a reply in the Day 1 thread ({subjectLine}).</p>
          )}
          <textarea className={cx(textareaClass, "min-h-56")} value={body} onChange={(ev) => setBody(ev.target.value)} aria-label="Email body" />
          {e.rationale && <p className="text-xs text-muted">Why this angle: {e.rationale}</p>}
          {e.attachment && (
            <p className={cx("text-xs", e.attachment.url ? "text-ok" : "text-muted")}>
              {e.attachment.url
                ? `Attached to the Gmail draft: ${e.attachment.title}`
                : `Suggested case study: ${e.attachment.title} (${e.attachment.docId}). Not attached: no file is configured in Settings. You can attach it in the Gmail draft.`}
            </p>
          )}
          {e.proofPoints.length > 0 && <p className="text-xs text-muted">Proof points used: {e.proofPoints.join(" · ")}</p>}
          <p className="text-xs text-muted">Your Gmail signature from Settings is added automatically.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!dirty || pending} onClick={() => run(() => editEmailAction(e.id, e.day === 1 ? subject : null, body))}>
              Save edits
            </Button>
            <Link href={`/prospects/${e.prospect.id}`} className="text-sm text-accent hover:underline">
              View research
            </Link>
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <input
              className={cx(inputClass, "w-64")}
              placeholder="e.g. lead with their new plant"
              value={instruction}
              onChange={(ev) => setInstruction(ev.target.value)}
              aria-label="Regeneration instruction"
            />
            <Button disabled={pending} onClick={() => run(() => regenerateEmailAction(e.id, instruction))}>
              Regenerate
            </Button>
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => run(() => rejectEmailAction(e.id, "skip"))}>
                Skip this email
              </Button>
              <Button variant="danger" disabled={pending} onClick={() => run(() => rejectEmailAction(e.id, "stop"))}>
                Stop cadence
              </Button>
            </span>
          </div>
          {msg && <Alert tone="danger">{msg}</Alert>}
        </div>
      )}
    </div>
  );
}
