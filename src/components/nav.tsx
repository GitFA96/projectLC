"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/roster", label: "Roster" },
  { href: "/loot", label: "Loot" },
  { href: "/admin/import", label: "Import" },
];

export function Nav({
  guildName,
  realm,
  activePhase,
}: {
  guildName: string;
  realm: string;
  activePhase: number;
}) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Swords className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold leading-tight">
            {guildName}
            <span className="block text-[11px] font-normal text-muted-foreground">{realm}</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <Badge variant="outline" className="gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Phase {activePhase} active
          </Badge>
        </div>
      </div>
    </header>
  );
}
