"use client";

import { useState, useTransition } from "react";
import { runMorningNowAction } from "@/app/actions";
import { Button } from "./ui";

export function RunMorningButton({ disabled }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {message && <span className="text-xs text-muted">{message}</span>}
      <Button
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            const res = await runMorningNowAction();
            setMessage(res.ok ? (res.message ?? "Started") : res.error);
          })
        }
      >
        Prepare today&apos;s follow-ups now
      </Button>
    </span>
  );
}
