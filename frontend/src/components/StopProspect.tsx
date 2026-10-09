"use client";

import { useState, useTransition } from "react";
import { stopProspectAction } from "@/app/actions";
import { Button } from "./ui";

export function StopProspect({ prospectId }: { prospectId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const stop = (reason: "meeting_booked" | "not_interested" | "stopped") =>
    startTransition(async () => {
      const res = await stopProspectAction(prospectId, reason);
      if (!res.ok) setError(res.error);
    });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button disabled={pending} onClick={() => stop("meeting_booked")}>
        Meeting booked
      </Button>
      <Button disabled={pending} onClick={() => stop("not_interested")}>
        Not interested
      </Button>
      <Button variant="danger" disabled={pending} onClick={() => stop("stopped")}>
        Stop cadence
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
