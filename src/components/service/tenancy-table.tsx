"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Ban, KeyRound, Loader2, ShieldCheck, Trash2, Undo2 } from "lucide-react";
import {
  purgeExpiredAction,
  revokeSessionsAction,
  setAccountDisabledAction,
  setAppAdminAction,
  type TenancyActionResult,
} from "@/app/service/tenancy/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AccountRow } from "@/lib/data/db";

/**
 * Every account on this deployment, and the two levers that matter.
 *
 * **Disabling ends access to the service; it does not remove anybody from a
 * guild.** Those are different decisions belonging to different people, and the
 * copy says so, because an operator reaching for "disable" to solve a guild
 * problem is the §7 boundary eroding one convenient click at a time.
 *
 * Note what is *not* here: roles, characters, capabilities, anything a person
 * holds inside a guild. `listAccounts` returns a guild **count** and nothing
 * more, so this screen cannot show it even by accident.
 */
function relative(iso: string | null): string {
  if (!iso) return "never";
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
  } catch {
    return "unknown";
  }
}

export function TenancyTable({ accounts, meId }: { accounts: AccountRow[]; meId: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<TenancyActionResult | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);

  const run = (fn: () => Promise<TenancyActionResult>) => {
    setResult(null);
    setConfirm(null);
    startTransition(async () => {
      const next = await fn();
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Guilds</TableHead>
            <TableHead>Sessions</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.id} className={a.disabled ? "opacity-60" : undefined}>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{a.discordUsername ?? "unnamed"}</span>
                  {a.id === meId && <Badge variant="outline">you</Badge>}
                  {a.appAdmin && (
                    <Badge variant="secondary" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      operator
                    </Badge>
                  )}
                  {a.disabled && <Badge variant="destructive">disabled</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground tabular-nums">{a.guildCount}</TableCell>
              <TableCell className="text-sm text-muted-foreground tabular-nums">{a.liveSessions}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{relative(a.lastSeenAt)}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  {a.liveSessions > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      title="Ends every session. They sign in again; a stolen cookie does not."
                      onClick={() => run(() => revokeSessionsAction(a.id))}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Sign out
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    title="Runs the deployment. Grants nothing inside any guild."
                    onClick={() => run(() => setAppAdminAction(a.id, !a.appAdmin))}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {a.appAdmin ? "Not an operator" : "Make operator"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      a.disabled
                        ? run(() => setAccountDisabledAction(a.id, false))
                        : confirm === a.id
                          ? run(() => setAccountDisabledAction(a.id, true))
                          : setConfirm(a.id)
                    }
                  >
                    {a.disabled ? <Undo2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    {a.disabled ? "Re-enable" : confirm === a.id ? "Really disable?" : "Disable"}
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {confirm && (
        <p className="text-xs text-muted-foreground">
          Disabling ends their access to this deployment and revokes their sessions.{" "}
          <strong>It does not remove them from any guild</strong> — that is the guild&apos;s own
          decision, on its members page.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(purgeExpiredAction)}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          Clear expired sessions and invitations
        </Button>
        <span className="text-xs text-muted-foreground">
          Redeemed invitations are kept — they record who let whom in.
        </span>
      </div>

      {result && (
        <p className={result.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {result.message}
        </p>
      )}
    </div>
  );
}
