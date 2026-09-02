"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
        <span className="font-semibold tracking-tight">AI Finance Controller</span>
        <nav className="flex gap-1 text-sm">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  active ? "bg-secondary text-secondary-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
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
