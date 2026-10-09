import { Suspense } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/auth/current-user";
import { NavLinks, NavList } from "@/components/NavLinks";
import { Badge, Skeleton } from "@/components/ui";

async function UserBadge() {
  const user = await getCurrentUser();
  return (
    <div className="space-y-2 text-sm">
      <p className="truncate font-medium" title={user.email}>
        {user.name ?? user.email}
      </p>
      {user.gmailConnected ? (
        <Badge tone="ok">Gmail connected</Badge>
      ) : (
        <Link href="/settings?connect=1">
          <Badge tone="warn">Connect Gmail</Badge>
        </Link>
      )}
      <form action="/api/auth/logout" method="post">
        <button className="text-xs text-muted hover:text-ink">Sign out</button>
      </form>
    </div>
  );
}

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col md:flex-row">
      <aside className="border-b border-line px-4 py-4 md:sticky md:top-0 md:h-screen md:w-52 md:shrink-0 md:border-r md:border-b-0 md:py-6">
        <div className="flex items-center justify-between gap-4 md:block">
          <Link href="/" className="block text-[15px] font-semibold tracking-tight">
            SDR Cadence
            <span className="block text-xs font-normal text-muted">Faclon Labs</span>
          </Link>
        </div>
        <div className="mt-4 md:mt-6">
          <Suspense fallback={<NavList />}>
            <NavLinks />
          </Suspense>
        </div>
        <div className="mt-6 hidden md:block">
          <Suspense fallback={<Skeleton className="h-16" />}>
            <UserBadge />
          </Suspense>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
