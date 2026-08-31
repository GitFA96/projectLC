"use client";

import * as React from "react";
import { ChevronRight, HandCoins, Loader2 } from "lucide-react";
import type { ReportPayback } from "@/lib/types";
import { buildPayback } from "@/lib/analysis/payback";
import type { GuildPolicy } from "@/lib/analysis/policy";
import { saveReportPayback } from "@/app/logs/actions";
import { Raider } from "@/components/logs/rank-bits";
import { useUnsavedGuard } from "@/components/use-unsaved-guard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const gold = (n: number) => `${Math.round(n).toLocaleString("en-US")}g`;

export interface PaybackSpenderRow {
  name: string;
  slug?: string;
  className?: string;
  /** Adjusted gold, as the ranking above has it saved. */
  gold: number;
}

/**
 * Where the officers record what the night banked and what has gone back out.
 *
 * It sits below the gold ranking rather than inside it, for the same reason the
 * price panel does: that card's ± presses are a buffered batch with its own
 * dirty flag, save button and unsaved-work guard, and a second kind of pending
 * edit sharing that buffer would make both harder to reason about. The ranking
 * reads what this writes and shows the split as a column.
 *
 * The pot is two numbers because it is two facts that move independently — how
 * many marks the raid banked this week, and what a mark is worth today. Storing
 * only the gold would quietly freeze last month's mark price into this month's
 * record.
 */
export function PaybackPanel({
  code,
  spenders,
  payback,
  policy,
}: {
  code: string;
  /** Everyone in the gold ranking, with their saved adjusted spend. */
  spenders: PaybackSpenderRow[];
  payback: ReportPayback;
  policy: GuildPolicy;
}) {
  const [open, setOpen] = React.useState(false);
  const [marks, setMarks] = React.useState(String(payback.marks || ""));
  const [markGold, setMarkGold] = React.useState(String(payback.markGold || ""));
  const [paid, setPaid] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(spenders.map((s) => [s.name, String(payback.paid[s.name] ?? "")])),
  );
  const [saving, startTransition] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [leavingTo, setLeavingTo] = React.useState<string | null>(null);

  const asNumber = (v: string) => {
    const n = Number(v.trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const draft: ReportPayback = {
    marks: Math.floor(asNumber(marks)),
    markGold: asNumber(markGold),
    paid: Object.fromEntries(
      Object.entries(paid)
        .map(([name, v]) => [name, asNumber(v)] as const)
        .filter(([, v]) => v > 0),
    ),
  };

  // Derived, not a flag: a box typed back to its saved value is not a change,
  // and neither is one cleared to "" against a stored zero.
  const dirty = JSON.stringify(draft) !== JSON.stringify(payback);
  const { leave } = useUnsavedGuard({ when: dirty, onIntercept: setLeavingTo });

  const split = buildPayback({
    spenders,
    pot: { marks: draft.marks, markGold: draft.markGold },
    paid: draft.paid,
    policy,
  });
  const outstanding = split.recommendedTotal - split.paidTotal;

  const save = (then?: () => void) => {
    setMsg(null);
    startTransition(async () => {
      const result = await saveReportPayback({ code, ...draft });
      setMsg(result.message);
      if (result.ok) then?.();
    });
  };

  return (
    <Card>
      <CardHeader className="cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ChevronRight
            className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
          <HandCoins className="h-4 w-4 text-success-ink" />
          Consumable payback
          {split.potRecorded ? (
            <span className="text-sm font-normal text-muted-foreground">
              {draft.marks} marks × {gold(draft.markGold)} = {gold(split.pot.gold)} to share
            </span>
          ) : (
            <span className="text-sm font-normal text-muted-foreground">
              no pot recorded for this night
            </span>
          )}
          {dirty && (
            <span className="ml-auto rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              unsaved
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The night&apos;s Marks of Illidari, shared out by what each raider spent on consumables —
          with the top {policy.payback.topTier} spenders&apos; spend counting{" "}
          {policy.payback.topWeight}× when the shares are worked out, and <em>nobody paid back more
          than they spent</em>. The recommendation is a <em>split of what the raid actually
          banked</em>, so the column adds up to the pot and never to more than it. The tier and the
          multiplier are the council&apos;s and live on the guild page.
        </p>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">
                Marks of Illidari banked
              </span>
              <Input
                type="number"
                min={0}
                step={1}
                value={marks}
                onChange={(e) => setMarks(e.target.value)}
                className="w-32"
                placeholder="30"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">
                Gold per mark, this week
              </span>
              <Input
                type="number"
                min={0}
                step={1}
                value={markGold}
                onChange={(e) => setMarkGold(e.target.value)}
                className="w-32"
                placeholder="100"
              />
            </label>
            <div className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">Pot</span>
              <p className="text-lg font-semibold tabular-nums">{gold(split.pot.gold)}</p>
            </div>
            {split.potRecorded && (
              <div className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">
                  Still to hand out
                </span>
                <p
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    outstanding <= 0 ? "text-success-ink" : "text-warn-ink",
                  )}
                >
                  {gold(Math.max(0, outstanding))}
                </p>
              </div>
            )}
            {split.marksUndistributed > 0 && (
              <div className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">
                  Stays in the bank
                </span>
                <p className="text-lg font-semibold tabular-nums text-info-ink">
                  {split.marksUndistributed} mark
                  {split.marksUndistributed === 1 ? "" : "s"}
                </p>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
              <Button size="sm" onClick={() => save()} disabled={!dirty || saving}>
                {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Save
              </Button>
            </div>
          </div>

          {!split.potRecorded ? (
            <p className="text-sm text-muted-foreground">
              Enter the marks the raid banked and what one is worth, and the split appears here and
              as a column on the ranking above. Until then the ranking shows no payback at all —
              &quot;nobody has recorded what we banked&quot; is a different statement from
              &quot;nobody is owed anything&quot;.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Raider</TableHead>
                  <TableHead className="w-20 text-right">Spent</TableHead>
                  <TableHead className="w-16 text-right">Share</TableHead>
                  <TableHead className="w-24 text-right">Recommended</TableHead>
                  <TableHead className="w-16 text-right">Marks</TableHead>
                  <TableHead className="w-28 text-right">Paid back</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {split.rows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Raider name={r.name} slug={r.slug} className={r.className} />
                        {r.top && !r.capped && (
                          <span
                            className="rounded-full bg-warn-fill px-1.5 py-px text-[10px] font-medium text-warn-ink"
                            title={`Top ${policy.payback.topTier} spender — spend counts ${policy.payback.topWeight}× in the split`}
                          >
                            boosted
                          </span>
                        )}
                        {r.capped && (
                          <span
                            className="rounded-full bg-info-fill px-1.5 py-px text-[10px] font-medium text-info-ink"
                            title="Held at what they spent. The rest of their share went back into the pot for everyone else."
                          >
                            at cap
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {gold(r.gold)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {(r.share * 100).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {gold(r.recommended)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{r.marks}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={paid[r.name] ?? ""}
                        onChange={(e) =>
                          setPaid((prev) => ({ ...prev, [r.name]: e.target.value }))
                        }
                        className="h-8 w-24 text-right tabular-nums"
                        placeholder="0"
                        aria-label={`Gold paid back to ${r.name}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 hover:bg-transparent">
                  <TableCell className="text-xs font-medium text-muted-foreground">Total</TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {gold(split.spendTotal)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    100%
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {gold(split.recommendedTotal)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {split.marksAllocated}
                  </TableCell>
                  <TableCell className="pr-3 text-right text-sm font-semibold tabular-nums">
                    {gold(split.paidTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}

          <p className="text-xs text-muted-foreground/70">
            <strong>Nobody is paid back more than they spent.</strong> A share that would go over
            is held at that raider&apos;s outlay and the difference goes back into the pot for
            everyone else — so the column still adds up, rather than quietly losing the remainder.
            When even that is not enough to place a mark, it stays in the bank and is counted
            above.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Marks are whole tokens, so the mark column is apportioned by largest remainder under
            that same ceiling — rounding each share on its own would either overspend the pot or
            hand somebody a mark worth more than their whole night. Nothing here touches the loot
            score or the standing board: being owed marks is neither a merit nor a demerit.
          </p>
        </CardContent>
      )}

      <Modal
        open={leavingTo !== null}
        onClose={() => setLeavingTo(null)}
        title="Unsaved payback"
        description="Leaving now throws away what you typed — nothing has been written yet."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLeavingTo(null)} disabled={saving}>
            Stay here
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const to = leavingTo;
              setLeavingTo(null);
              if (to) leave(to);
            }}
            disabled={saving}
          >
            Leave without saving
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const to = leavingTo;
              setLeavingTo(null);
              save(() => to && leave(to));
            }}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Save and leave
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
