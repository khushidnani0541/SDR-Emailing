import { Suspense } from "react";
import { Alert, Card } from "@/components/ui";

async function LoginError({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return error ? <Alert tone="danger">{error}</Alert> : null;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <h1 className="text-lg font-semibold tracking-tight">SDR Cadence</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in with your Google Workspace account. The same step connects Gmail so your approved emails can be queued in your inbox.
        </p>
        <div className="mt-4">
          <Suspense>
            <LoginError searchParams={searchParams as Promise<{ error?: string }>} />
          </Suspense>
        </div>
        <a
          href="/api/auth/google/start"
          className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-accent text-sm font-medium text-white hover:bg-[#0b5a4b]"
        >
          Continue with Google
        </a>
        <p className="mt-4 text-xs text-muted">
          We request permission to create and send Gmail drafts, read replies to your cadence threads, and read the Sheets and Docs you link.
        </p>
      </Card>
    </main>
  );
}
