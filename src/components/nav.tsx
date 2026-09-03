"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/review", label: "Review" },
  { href: "/upload", label: "Upload" },
  { href: "/assistant", label: "Assistant" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-sm">
            <Landmark className="h-4.5 w-4.5" strokeWidth={2.25} />
          </span>
          <span className="font-semibold tracking-tight">AI Finance Controller</span>
        </Link>
        <nav className="flex gap-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-colors",
                  active ? "bg-brand text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/70",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
