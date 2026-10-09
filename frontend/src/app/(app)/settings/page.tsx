import { Suspense, type ReactNode } from "react";
import { getCurrentUser } from "@/auth/current-user";
import { env } from "@/lib/env";
import { effectiveSettings } from "@/services/cadence/actions";
import { getAppSettings } from "@/services/cadence/context";
import { getActiveTemplates, TEMPLATE_DAYS } from "@/services/drafting/templates";
import { LINKEDIN_DAY } from "@/services/cadence/calendar";
import { attachmentsConfigured } from "@/services/attachments/case-studies";
import { CaseStudyFilesForm, OrgSettingsForm, SdrSettingsForm, TemplateImportForm } from "@/components/SettingsForms";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  );
}

async function Settings() {
  const user = await getCurrentUser();
  const s = effectiveSettings({ settings: user.settings });
  const org = await getAppSettings();
  const templates = await getActiveTemplates();

  return (
    <div className="max-w-3xl space-y-6">
      <Section title="Gmail" description="Approved emails are created as drafts in your Gmail and sent at the scheduled time.">
        <div className="flex flex-wrap items-center gap-3">
          {user.gmailConnected ? <Badge tone="ok">Connected as {user.email}</Badge> : <Badge tone="warn">Not connected</Badge>}
          <a href="/api/auth/google/start" className="text-sm font-medium text-accent hover:underline">
            {user.gmailConnected ? "Reconnect" : "Connect Gmail"}
          </a>
        </div>
      </Section>

      <Section title="Sending">
        <SdrSettingsForm
          globalDraftOnly={env().SEND_MODE === "draft_only"}
          values={{
            timezone: s.timezone,
            day1SendTime: s.day1SendTime,
            defaultSendTime: s.defaultSendTime,
            morningRunTime: s.morningRunTime,
            spreadMinutes: s.spreadMinutes,
            dailyCap: s.dailyCap,
            signature: s.signature ?? "",
            holidays: s.holidays ?? [],
            draftOnly: !!s.draftOnly,
          }}
        />
      </Section>

      <Section
        title="Cadence templates"
        description="Shared by all SDRs. Emails keep this wording and only the {{placeholders}} are filled from research. Day 12 needs no AI at all."
      >
        <TemplateImportForm docUrl={org.cadenceDocUrl ?? ""} />
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">
            Current templates {templates.version ? `(imported v${templates.version})` : "(built-in copy of the SDR Cadence doc)"}
          </summary>
          <div className="mt-3 space-y-3">
            {TEMPLATE_DAYS.map((d) => (
              <div key={d}>
                <p className="font-medium">Day {d}{d === LINKEDIN_DAY ? " · LinkedIn connection request" : " · Email"}</p>
                <p className="whitespace-pre-wrap text-muted">{templates.byDay[d]}</p>
              </div>
            ))}
          </div>
        </details>
      </Section>

      <Section
        title="Case study files"
        description="Day 4 says the case study is attached. Until a file source is configured here, emails offer to send it instead and show the suggested case study for you to attach manually."
      >
        <div className="mb-4">
          {attachmentsConfigured(org.caseStudyFiles) ? (
            <Badge tone="ok">Attachments on</Badge>
          ) : (
            <Badge>Attachments off: the Collateral Library doesn&apos;t serve files yet</Badge>
          )}
        </div>
        <CaseStudyFilesForm urlTemplate={org.caseStudyFiles?.urlTemplate ?? ""} byDocId={org.caseStudyFiles?.byDocId ?? {}} />
      </Section>

      <Section title="Referenceable clients" description="Shared by all SDRs. Used for {{Relevant Companies}} in Day 1.">
        <OrgSettingsForm referenceableClients={org.referenceableClients ?? []} />
      </Section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<Skeleton className="h-96 max-w-3xl" />}>
        <Settings />
      </Suspense>
    </>
  );
}
