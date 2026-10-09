"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { logCallAction } from "@/app/actions";
import { Alert, Badge, Button, Card, cx, inputClass } from "./ui";

export type CallItem = {
  id: string;
  day: number;
  dueDate: string;
  overdue: boolean;
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
  if (!calls.length) return <Card className="px-6 py-8 text-center text-sm text-muted">No calls due today.</Card>;
  return (
    <Card className="divide-y divide-line">
      {calls.map((c) => (
        <CallRow key={c.id} call={c} />
      ))}
    </Card>
  );
}

function CallRow({ call: c }: { call: CallItem }) {
  const [outcome, setOutcome] = useState("no_answer");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={c.overdue ? "warn" : "neutral"}>
          Day {c.day} call{c.overdue ? ` · due ${c.dueDate}` : ""}
        </Badge>
        <Link href={`/prospects/${c.prospect.id}`} className="font-medium hover:underline">
          {c.prospect.name}
        </Link>
        <span className="text-sm text-muted">
          {c.prospect.title ? `${c.prospect.title} · ` : ""}
          {c.prospect.company}
        </span>
      </div>
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
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await logCallAction(c.id, outcome, notes);
              if (!res.ok) setError(res.error);
            })
          }
        >
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
