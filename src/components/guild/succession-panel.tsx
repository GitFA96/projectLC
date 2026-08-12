"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Crown, Loader2 } from "lucide-react";
import {
  claimOwnershipAction,
  setSuccessionWindowsAction,
  type SuccessionActionResult,
} from "@/app/succession-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUCCESSION_BOUNDS, type SuccessionState } from "@/lib/auth/succession";

/**
 * What happens when everyone who owns this guild goes quiet.
 *
 * Two audiences on one subject, which is why they are two components. The
 * **banner** is for everybody and appears only when it has something to say —
 * a permanent notice about a thing that is not happening is noise, and noise is
 * what gets ignored on the day it matters. The **settings** are for whoever can
 * edit the guild, and sit with the guild's other decisions.
 */

function Result({ result }: { result: SuccessionActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.message}
    </p>
  );
}

/**
 * Shown when the owners have been quiet long enough to matter.
 *
 * Deliberately visible to **every member**, not just the eligible ones. A
 * takeover that arrives as a surprise is the failure mode worth designing
 * against: the guild should have had weeks of warning, and an owner who is
 * merely on holiday should see it the moment they sign in and be able to stop
 * the clock by simply being here.
 */
export function SuccessionBanner({
  state,
  canClaim,
}: {
  state: SuccessionState;
  canClaim: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<SuccessionActionResult | null>(null);

  if (state.status === "healthy") return null;

  const days = Math.floor(state.quietDays);
  const unlocked = state.status === "unlocked" || state.status === "ownerless";

  return (
    <div
      className={
        unlocked
          ? "mb-6 rounded-md border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink"
          : "mb-6 rounded-md border border-warn-line bg-warn-soft p-3 text-sm text-warn-ink"
      }
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {state.status === "ownerless" ? (
            <>This guild has no owner.</>
          ) : (
            <>
              No owner of this guild has signed in for <strong>{days} days</strong>.
            </>
          )}{" "}
          {unlocked ? (
            <>
              Members can now take ownership so the guild is not left stuck. The current owners keep
              theirs — nobody is being removed.
            </>
          ) : (
            <>
              If that continues, members will be able to take ownership so the guild is not left
              stuck. An owner signing in stops the clock.
            </>
          )}
        </span>
      </p>

      {canClaim && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setResult(null);
              startTransition(async () => {
                const next = await claimOwnershipAction();
                setResult(next);
                if (next.ok) router.refresh();
              });
            }}
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
            Take ownership
          </Button>
          <Result result={result} />
        </div>
      )}
    </div>
  );
}

/** The guild choosing how long it tolerates silence. */
export function SuccessionSettings({ state }: { state: SuccessionState }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [admin, setAdmin] = React.useState(String(state.windows.administrativeDays));
  const [member, setMember] = React.useState(String(state.windows.memberDays));
  const [result, setResult] = React.useState<SuccessionActionResult | null>(null);

  return (
    <div className="space-y-3">
      <div className="grid max-w-md gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="succession-admin">Officers may step in after</Label>
          <Input
            id="succession-admin"
            type="number"
            min={SUCCESSION_BOUNDS.min}
            max={SUCCESSION_BOUNDS.max}
            value={admin}
            disabled={pending}
            onChange={(e) => setAdmin(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Days of silence from <em>every</em> owner, before anyone who can manage members or roles
            may take ownership.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="succession-member">Any member may after</Label>
          <Input
            id="succession-member"
            type="number"
            min={SUCCESSION_BOUNDS.min}
            max={SUCCESSION_BOUNDS.max}
            value={member}
            disabled={pending}
            onChange={(e) => setMember(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The backstop for a guild with owners and members but nobody in between — otherwise the
            first window has nobody in it and nothing ever happens.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const next = await setSuccessionWindowsAction(Number(admin), Number(member));
              setResult(next);
              if (next.ok) router.refresh();
            });
          }}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Result result={result} />
      </div>

      <p className="text-xs text-muted-foreground">
        Kept between {SUCCESSION_BOUNDS.min} and {SUCCESSION_BOUNDS.max} days. Longer would let an
        owner switch off the one protection that exists to guard a guild from an absent owner;
        shorter would let a fortnight&apos;s holiday cost somebody their guild.
      </p>
    </div>
  );
}
