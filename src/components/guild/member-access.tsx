"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { CAPABILITIES, CAPABILITY_GROUPS, type Capability } from "@/lib/auth/capabilities";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * One member's answers, all of them computed on the server by `permits()`.
 *
 * Booleans rather than grants, deliberately: the client must not re-derive who
 * may do what from a capability list, because that would be a second copy of
 * the rule living where nobody would think to look for it. This component only
 * chooses whose pre-computed answers to show.
 */
export interface MemberAccess {
  membershipId: string;
  displayName: string;
  isGuildMaster: boolean;
  roleNames: string[];
  /** Capability id → would `permits()` allow it. */
  capabilities: Partial<Record<Capability, boolean>>;
  /** Route href → would `permits()` allow it. */
  pages: Record<string, boolean>;
}

/** A route, with the need spelled out — `ROUTE_NEEDS` cannot cross to a client. */
export interface RouteNeed {
  href: string;
  need: string;
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="yes" />
  ) : (
    <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="no" />
  );
}

/**
 * What one member can see and do — one member at a time, chosen by name.
 *
 * This used to be a column per member across two wide tables, which answers
 * "who can do what" for a guild of eight and nothing at all for a guild of
 * eighty: the tables grow sideways with the roster until every answer is behind
 * a horizontal scrollbar. The question an officer actually arrives with is
 * about **one person** — "can Katze open the priority sheet" — so the page asks
 * which person and then answers it fully. Height is constant in roster size.
 *
 * Both lists show denials as well as grants. A permission somebody lacks is the
 * more interesting half of the answer, and hiding it would leave "not shown"
 * and "not allowed" looking the same.
 */
export function MemberAccessPanel({
  members,
  routes,
}: {
  members: MemberAccess[];
  routes: RouteNeed[];
}) {
  const [selectedId, setSelectedId] = React.useState(members[0]?.membershipId ?? "");
  const selected = members.find((m) => m.membershipId === selectedId) ?? members[0];

  if (!selected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What one member can do</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nobody has joined this guild yet. Invitations are on the members page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const caps = Object.keys(CAPABILITIES) as Capability[];
  const capsHeld = caps.filter((id) => selected.capabilities[id]).length;
  const pagesOpen = routes.filter((r) => selected.pages[r.href]).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3">
          <span>What one member can do</span>
          <Select value={selected.membershipId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-56" aria-label="Member to preview">
              {/* The placeholder carries the server-rendered name: Radix fills
                  the trigger from its items, which only register on the client,
                  so without this the picker reads blank until hydration while
                  the answers beside it are already on screen. */}
              <SelectValue placeholder={selected.displayName} />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.membershipId} value={m.membershipId}>
                  {m.displayName}
                  {m.isGuildMaster && " 👑"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardTitle>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            Holds {capsHeld} of {caps.length} permissions · can open {pagesOpen} of {routes.length}{" "}
            pages
          </span>
          {selected.isGuildMaster ? (
            <Badge variant="muted">owner — holds everything implicitly</Badge>
          ) : selected.roleNames.length > 0 ? (
            selected.roleNames.map((name) => (
              <Badge key={name} variant="muted">
                {name}
              </Badge>
            ))
          ) : (
            <Badge variant="muted">no roles — baseline only</Badge>
          )}
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium">Permissions</p>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {CAPABILITY_GROUPS.map((group) => {
              const inGroup = caps.filter((id) => CAPABILITIES[id].group === group.id);
              return (
                <div key={group.id}>
                  <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {inGroup.map((id) => {
                      const ok = selected.capabilities[id] ?? false;
                      return (
                        <li key={id} className="flex items-baseline gap-2 text-sm">
                          <span className="translate-y-0.5">
                            <Mark ok={ok} />
                          </span>
                          <span className={cn(!ok && "text-muted-foreground")}>
                            {CAPABILITIES[id].label}
                          </span>
                          <code className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {id}
                          </code>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            An owner holds everything implicitly and cannot be stripped of any of it — that is what
            makes it impossible to lock this guild out of itself.
          </p>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Pages they can open</p>
          <ul className="grid gap-x-8 gap-y-0.5 sm:grid-cols-2">
            {routes.map(({ href, need }) => {
              const ok = selected.pages[href] ?? false;
              return (
                <li key={href} className="flex items-baseline gap-2 text-sm">
                  <span className="translate-y-0.5">
                    <Mark ok={ok} />
                  </span>
                  <code className={cn("font-mono text-xs", !ok && "text-muted-foreground")}>
                    {href}
                  </code>
                  <Badge variant="muted" className="ml-auto text-[10px]">
                    {need}
                  </Badge>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            A signed-out visitor reaches only the pages marked <code>public</code>.{" "}
            <code>/service</code> is the operator console and belongs to whoever runs this
            deployment, not to this guild — no member of it holds those, owner included.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
