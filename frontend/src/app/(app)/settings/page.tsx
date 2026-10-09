import { Suspense, type ReactNode } from "react";
import { getCurrentUser } from "@/auth/current-user";
import { env } from "@/lib/env";
import { effectiveSettings } from "@/services/cadence/actions";
import { getAppSettings } from "@/services/cadence/context";
import { getActiveTemplates } from "@/services/drafting/templates";
import { EMAIL_DAYS } from "@/services/cadence/calendar";
import { OrgSettingsForm, SdrSettingsForm, TemplateImportForm } from "@/components/SettingsForms";
import { Alert, Badge, Card, PageHeader, Skeleton } from "@/components/ui";

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

      <Section title="Email templates" description="Shared by all SDRs. Drafts follow these guidelines for each cadence day.">
        {templates.version === 0 && (
          <div className="mb-4">
            <Alert tone="warn">Using placeholder templates. Import the SDR cadence doc to use the real ones.</Alert>
          </div>
        )}
        <TemplateImportForm docUrl={org.cadenceDocUrl ?? ""} />
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">Current guidelines {templates.version ? `(v${templates.version})` : "(placeholder)"}</summary>
          <div className="mt-3 space-y-3">
            {EMAIL_DAYS.map((d) => (
              <div key={d}>
                <p className="font-medium">Day {d}</p>
                <p className="whitespace-pre-wrap text-muted">{templates.byDay[d]}</p>
              </div>
            ))}
          </div>
        </details>
      </Section>

      <Section title="Referenceable clients" description="Shared by all SDRs.">
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
