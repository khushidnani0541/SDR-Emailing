"use client";

import { useActionState } from "react";
import {
  importTemplatesAction,
  saveCaseStudyFilesAction,
  saveOrgSettingsAction,
  saveSettingsAction,
  type ActionResult,
} from "@/app/actions";
import { Alert, Button, Field, inputClass, textareaClass } from "./ui";

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <Alert tone={state.ok ? "ok" : "danger"}>{state.ok ? (state.message ?? "Saved") : state.error}</Alert>;
}

export type SettingsValues = {
  timezone: string;
  day1SendTime: string;
  defaultSendTime: string;
  morningRunTime: string;
  spreadMinutes: number;
  dailyCap: number;
  signature: string;
  holidays: string[];
  draftOnly: boolean;
};

export function SdrSettingsForm({ values, globalDraftOnly }: { values: SettingsValues; globalDraftOnly: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveSettingsAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Timezone" hint="IANA name. Default America/New_York (US Eastern)">
          <input name="timezone" className={inputClass} defaultValue={values.timezone} required />
        </Field>
        <Field label="Morning preparation time" hint="When today's Day 4/7/12 follow-ups are drafted for review">
          <input name="morningRunTime" type="time" className={inputClass} defaultValue={values.morningRunTime} required />
        </Field>
        <Field label="Day 1 send time" hint="Default for new uploads (on the upload day)">
          <input name="day1SendTime" type="time" className={inputClass} defaultValue={values.day1SendTime} required />
        </Field>
        <Field label="Follow-up send time" hint="Default for Day 4, 7 and 12">
          <input name="defaultSendTime" type="time" className={inputClass} defaultValue={values.defaultSendTime} required />
        </Field>
        <Field label="Spread sends over (minutes)" hint="Emails go out one by one across this window">
          <input name="spreadMinutes" type="number" min={0} max={480} className={inputClass} defaultValue={values.spreadMinutes} />
        </Field>
        <Field label="Daily send cap">
          <input name="dailyCap" type="number" min={1} max={500} className={inputClass} defaultValue={values.dailyCap} />
        </Field>
        <Field label="Holidays" hint="YYYY-MM-DD, comma separated. Cadence days skip these.">
          <input name="holidays" className={inputClass} defaultValue={values.holidays.join(", ")} />
        </Field>
      </div>
      <Field label="Email signature" hint="Appended to every email. Plain text.">
        <textarea name="signature" className={`${textareaClass} min-h-24`} defaultValue={values.signature} />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="draftOnly" defaultChecked={values.draftOnly} className="mt-0.5 size-4 accent-[var(--accent)]" />
        <span>
          Draft-only mode — approved emails wait in Gmail drafts and are never sent automatically.
          {globalDraftOnly && <span className="block text-xs text-warn">The server is in draft-only mode (SEND_MODE=draft_only), so nothing is sent regardless.</span>}
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={pending}>
          Save settings
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TemplateImportForm({ docUrl }: { docUrl: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(importTemplatesAction, null);
  return (
    <form action={action} className="space-y-3">
      <p className="text-xs text-muted">
        The doc needs &ldquo;Day 1&rdquo;, &ldquo;Day 4&rdquo;, &ldquo;Day 6&rdquo; (LinkedIn), &ldquo;Day 7&rdquo; and &ldquo;Day 12&rdquo; headings. Re-import whenever the templates change.
      </p>
      <Field label="Upload the doc (.docx)" hint="Use this for a Word file stored in Drive (File → Download → .docx).">
        <input name="file" type="file" accept=".docx,.txt" className="block text-sm" />
      </Field>
      <Field label="…or a native Google Docs link">
        <input name="docUrl" type="url" className={inputClass} defaultValue={docUrl} placeholder="https://docs.google.com/document/d/…" />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Importing…" : "Import templates"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function CaseStudyFilesForm({ urlTemplate, byDocId }: { urlTemplate: string; byDocId: Record<string, string> }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveCaseStudyFilesAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field
        label="File URL pattern"
        hint="For when the Collateral Library serves files: a download URL with {id} where the document id goes, e.g. https://data-room.faclon.com/…/files/{id}"
      >
        <input name="urlTemplate" className={inputClass} defaultValue={urlTemplate} placeholder="https://…/{id}" />
      </Field>
      <Field label="Or individual files" hint="One per line: document-id = https://link-to.pdf (PDF, PPTX or DOCX, up to 10 MB). These win over the pattern.">
        <textarea
          name="byDocId"
          className={`${textareaClass} min-h-24 font-mono text-xs`}
          defaultValue={Object.entries(byDocId)
            .map(([id, url]) => `${id} = ${url}`)
            .join("\n")}
          placeholder="jsw-cements-dolvi-poc-results-summary = https://…/case-study.pdf"
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function OrgSettingsForm({ referenceableClients }: { referenceableClients: string[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveOrgSettingsAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Clients we may name in emails" hint="One per line. Other clients from the collateral are anonymised, and the reviewer is warned if one slips through. Leave empty to skip this check.">
        <textarea name="referenceableClients" className={`${textareaClass} min-h-28`} defaultValue={referenceableClients.join("\n")} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save list
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}
