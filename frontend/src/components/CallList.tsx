"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { logCallAction } from "@/app/actions";
import { Alert, Badge, Button, Card, cx, inputClass } from "./ui";

export type CallItem = {
  id: string;
  day: number;
  kind: "call" | "linkedin";
  dueDate: string;
  overdue: boolean;
  phone: string | null;
  linkedinUrl: string | null;
  linkedinMessage: string | null;
  prospect: { id: string; name: string; title: string | null; company: string; email: string };
  opener: string | null;
  priorities: string[];
};

const OUTCOMES = [
  { value: "no_answer", label: "No answer" },
  { value: "connected", label: "Connected" },
  { value: "meeting_booked", label: "Meeting booked (stops cadence)" },
  { value: "not_interested", label: "Not interested (stops cadence)" },
  { value: "wrong_person", label: "Wrong person (stops cadence)" },
];

export function CallList({ calls }: { calls: CallItem[] }) {
  if (!calls.length) return <Card className="px-6 py-8 text-center text-sm text-muted">No calls or LinkedIn tasks due today.</Card>;
  return (
    <Card className="divide-y divide-line">
      {calls.map((c) => (c.kind === "linkedin" ? <LinkedInRow key={c.id} task={c} /> : <CallRow key={c.id} call={c} />))}
    </Card>
  );
}

function Who({ c, label }: { c: CallItem; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={c.overdue ? "warn" : c.kind === "linkedin" ? "accent" : "neutral"}>
        Day {c.day} {label}
        {c.overdue ? ` · due ${c.dueDate}` : ""}
      </Badge>
      <Link href={`/prospects/${c.prospect.id}`} className="font-medium hover:underline">
        {c.prospect.name}
      </Link>
      <span className="text-sm text-muted">
        {c.prospect.title ? `${c.prospect.title} · ` : ""}
        {c.prospect.company}
      </span>
    </div>
  );
}

function useLog(id: string) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const log = (outcome: string, notes = "") =>
    startTransition(async () => {
      setError(null);
      const res = await logCallAction(id, outcome, notes);
      if (!res.ok) setError(res.error);
    });
  return { error, pending, log };
}

function CallRow({ call: c }: { call: CallItem }) {
  const [outcome, setOutcome] = useState("no_answer");
  const [notes, setNotes] = useState("");
  const { error, pending, log } = useLog(c.id);

  return (
    <div className="px-4 py-3">
      <Who c={c} label="call" />
      {c.phone && (
        <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="mt-1 inline-block text-sm font-medium text-accent tabular-nums hover:underline">
          {c.phone}
        </a>
      )}
      {c.opener && <p className="mt-1.5 text-sm">&ldquo;{c.opener}&rdquo;</p>}
      {c.priorities.length > 0 && <p className="mt-1 text-xs text-muted">Likely on their mind: {c.priorities.join(" · ")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select className={cx(inputClass, "w-auto")} value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Call outcome">
          {OUTCOMES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className={cx(inputClass, "min-w-48 flex-1")}
          placeholder="Notes (used in the next email)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Call notes"
        />
        <Button disabled={pending} onClick={() => log(outcome, notes)}>
          Log call
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}

function LinkedInRow({ task: c }: { task: CallItem }) {
  const [copied, setCopied] = useState(false);
  const { error, pending, log } = useLog(c.id);

  async function copy() {
    if (!c.linkedinMessage) return;
    try {
      await navigator.clipboard.writeText(c.linkedinMessage);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="px-4 py-3">
      <Who c={c} label="LinkedIn" />
      {c.linkedinMessage && (
        <p className="mt-1.5 rounded-md bg-bg px-3 py-2 text-sm" aria-label="Connection request message">
          {c.linkedinMessage}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button onClick={copy}>{copied ? "Copied" : "Copy message"}</Button>
        {c.linkedinUrl ? (
          <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
            Open LinkedIn profile ↗
          </a>
        ) : (
          <span className="text-xs text-muted">No LinkedIn URL in the sheet</span>
        )}
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" disabled={pending} onClick={() => log("linkedin_skipped")}>
            Skip
          </Button>
          <Button variant="primary" disabled={pending} onClick={() => log("linkedin_sent")}>
            Request sent
          </Button>
        </span>
      </div>
      {error && (
        <div className="mt-2">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}
