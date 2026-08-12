"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import {
  BREAK_GLASS_MAX_MINUTES,
  closeBreakGlassAction,
  openBreakGlassAction,
  type BreakGlassResult,
} from "@/app/service/break-glass-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The operator reaching into a guild they are not in.
 *
 * Deliberately the least pleasant control in the app. It is folded away, it
 * demands a sentence of justification, and the copy tells you exactly who is
 * about to read it — because a back door that is comfortable to use stops being
 * an exception and becomes the way things get done.
 *
 * The alternative people reach for is an operator who can simply see
 * everything. That has no reason attached, no expiry, and nothing for the guild
 * to read afterwards, which is three fewer reasons for anybody to think twice.
 */
export function BreakGlassCard({
  guildId,
  guildName,
  open,
  isMember,
}: {
  guildId: string;
  guildName: string;
  /** The viewer's own open override for this guild, if any. */
  open: { reason: string; expiresAt: string } | null;
  /** Members already have whatever their membership grants — this is not for them. */
  isMember: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [showing, setShowing] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [minutes, setMinutes] = React.useState("30");
  const [result, setResult] = React.useState<BreakGlassResult | null>(null);

  const run = (fn: () => Promise<BreakGlassResult>) => {
    setResult(null);
    startTransition(async () => {
      const next = await fn();
      setResult(next);
      if (next.ok) {
        setShowing(false);
        setReason("");
        router.refresh();
      }
    });
  };

  if (isMember) {
    return (
      <p className="text-sm text-muted-foreground">
        You are a member of {guildName}, so you already have whatever your membership there grants.
        Break-glass is only for guilds you are not in.
      </p>
    );
  }

  if (open) {
    return (
      <div className="space-y-2 rounded-md border border-warn-line bg-warn-soft p-3">
        <p className="flex items-start gap-2 text-sm text-warn-ink">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You have an override open on <strong>{guildName}</strong> until{" "}
            {new Date(open.expiresAt).toLocaleTimeString()}. Everything you do with it is written
            into their audit log, where their members can read it.
          </span>
        </p>
        <p className="text-xs text-warn-ink">Reason on record: {open.reason}</p>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => closeBreakGlassAction(guildId))}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Close it now
        </Button>
        {result && <p className="text-xs text-warn-ink">{result.message}</p>}
      </div>
    );
  }

  if (!showing) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          You hold nothing inside {guildName}. Running this deployment is not membership of the
          guilds on it — reaching one takes a temporary, reasoned override that they can see.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setShowing(true)}>
          <ShieldAlert className="h-3.5 w-3.5" />
          Break glass
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-warn-line p-3">
      <p className="text-sm">
        This gives you an officer&apos;s access to <strong>{guildName}</strong> — their roster,
        their loot ledger, their council notes. <strong>They will be told you opened it</strong>,
        and every capability you use is logged against your reason.
      </p>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="bg-reason">Why</Label>
          <Input
            id="bg-reason"
            value={reason}
            maxLength={300}
            disabled={pending}
            placeholder="Realm transfer — support request from their guild master"
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bg-minutes">Minutes</Label>
          <Input
            id="bg-minutes"
            type="number"
            min={1}
            max={BREAK_GLASS_MAX_MINUTES}
            className="w-28"
            value={minutes}
            disabled={pending}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending || reason.trim().length < 10}
          onClick={() => run(() => openBreakGlassAction(guildId, reason, Number(minutes)))}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Open the override
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setShowing(false)}>
          Cancel
        </Button>
        {result && (
          <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Expires by itself after at most {BREAK_GLASS_MAX_MINUTES} minutes — nobody has to remember
        to close it for the guild to be safe again.
      </p>
    </div>
  );
}
