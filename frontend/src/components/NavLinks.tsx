"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/upload", label: "Upload" },
  { href: "/prospects", label: "Prospects" },
  { href: "/industries", label: "Industries" },
  { href: "/costs", label: "Costs" },
  { href: "/settings", label: "Settings" },
];

/** Static nav (no active state) — used as the prerendered fallback on dynamic routes. */
export function NavList({ pathname }: { pathname?: string }) {
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto md:flex-col">
      {LINKS.map((l) => {
        const active = pathname !== undefined && (l.href === "/" ? pathname === "/" : pathname.startsWith(l.href));
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
              active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-black/5 hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavLinks() {
  return <NavList pathname={usePathname()} />;
}
