"use client";

import { Check, ChevronDown, CircleHelp, Minus } from "lucide-react";
import type { BuffCoverage, BoardView } from "@/lib/analysis/raid-planner";
import {
  PARTY_BUFFS,
  SCOPE_LABELS,
  buffLabel,
  type BuffScope,
} from "@/lib/constants/raid-buffs";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Reading a board: what each group gets, and what the raid gets.
 *
 * Three states, never two — see `analysis/board.ts`. The dashed amber
 * chip ("conditional") is doing real work: it means somebody of the right class
 * is standing there and nothing has confirmed the spec or talent. An officer
 * can settle that in a second by asking; an app that guessed would have them
 * moving people for no reason.
 */

const STATE_STYLE: Record<BuffCoverage["state"], string> = {
  covered: "border-success-line bg-success-soft text-success-ink",
  conditional: "border-dashed border-warn-line bg-warn-soft/70 text-warn-ink",
  missing: "border-dashed border-muted-foreground/25 text-muted-foreground/60",
};

const STATE_ICON = {
  covered: Check,
  conditional: CircleHelp,
  missing: Minus,
} as const;

/** Everything hover has to say about one buff — who brings it, and what the log knows. */
function buffTitle(cover: BuffCoverage): string {
  const { buff } = cover;
  const lines = [`${buff.name} — ${buff.effect}`];

  if (cover.providers.length > 0) {
    lines.push(`From: ${cover.providers.map((p) => p.name).join(", ")}`);
  }
  if (cover.possible.length > 0) {
    const who = cover.possible.map((p) => p.name).join(", ");
    const requires = buff.sources.find((s) => s.requires)?.requires;
    lines.push(
      buff.exclusiveWith
        ? `Could bring it: ${who} — but one ${buff.exclusiveWith} at a time, so this is a choice they make, not something their class guarantees.`
        : `Unconfirmed: ${who} — right class, but ${
            requires ? `nothing confirms the ${requires}` : "the spec was never recorded"
          }.`,
    );
  }
  if (cover.state === "missing") {
    lines.push(
      buff.openTo
        ? `Nobody here is logged bringing it. Open to ${buff.openTo}.`
        : `Nobody here brings it. Needs: ${buff.sources.map((s) => s.wowClass).join(", ") || "—"}.`,
    );
  }
  if (cover.evidenced.length > 0) {
    lines.push(`The log caught ${cover.evidenced.map((p) => p.name).join(", ")} providing it.`);
  } else if (buff.unloggedBecause) {
    lines.push(`Not confirmable: ${buff.unloggedBecause}`);
  }
  return lines.join("\n");
}

function BuffChip({
  cover,
  compact = false,
}: {
  cover: BuffCoverage;
  compact?: boolean;
}) {
  const Icon = STATE_ICON[cover.state];
  return (
    <span
      title={buffTitle(cover)}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] leading-tight whitespace-nowrap",
        STATE_STYLE[cover.state],
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden />
      {buffLabel(cover.buff)}
      {/* A tick inside the chip: this one isn't a prediction, the log saw it. */}
      {cover.evidenced.length > 0 && !compact && <span className="opacity-60">·logged</span>}
    </span>
  );
}

/**
 * The party buffs one group has, folded away behind a count.
 *
 * A full group brings twenty-odd chips. Eight groups of that at once buried the
 * board itself — and the board is the thing you are arranging. So each group
 * shows the number, which is the at-a-glance comparison an officer wants
 * ("group 5 only has four?"), and opens on demand. A plain `<details>` because
 * it needs no state, keyboard-works for free, and eight of them can be open at
 * once without fighting each other.
 */
export function GroupBuffPanel({ coverage }: { coverage: BuffCoverage[] }) {
  const has = coverage.filter((c) => c.state !== "missing");
  const covered = coverage.filter((c) => c.state === "covered").length;

  /*
   * The summary line is always here, at the same height, whether the group has
   * buffs or none — an empty group and a full one must produce cards of
   * identical height, or seating a raider nudges the whole board down and the
   * next bench click misses. Same reason the open list is height-capped and
   * scrolls: opening it is a choice, growing under the cursor is not.
   */
  return (
    <details className="pt-1 [&[open]>summary_.chevron]:rotate-180">
      <summary
        // The card behind this is a drop target with its own onClick; opening
        // the buff list must not also seat whoever is being held.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex h-4 list-none items-center gap-1 overflow-hidden text-[11px] whitespace-nowrap",
          has.length === 0
            ? "pointer-events-none text-muted-foreground/50"
            : "cursor-pointer text-muted-foreground hover:text-foreground",
        )}
      >
        {has.length === 0 ? (
          "No party buffs"
        ) : (
          <>
            <ChevronDown className="chevron h-3 w-3 shrink-0 transition-transform" aria-hidden />
            {covered} buff{covered === 1 ? "" : "s"}
            {has.length > covered && (
              <span className="text-warn-ink">+{has.length - covered} possible</span>
            )}
          </>
        )}
      </summary>
      <div
        className="flex max-h-28 flex-wrap gap-1 overflow-y-auto pt-1"
        onClick={(e) => e.stopPropagation()}
      >
        {has.map((c) => (
          <BuffChip key={c.buff.id} cover={c} compact />
        ))}
      </div>
    </details>
  );
}

const CELL_STYLE: Record<BuffCoverage["state"], string> = {
  covered: "bg-success-fill text-success-ink",
  conditional: "bg-warn-fill/70 text-warn-ink",
  missing: "text-muted-foreground/25",
};

/**
 * Party buffs × groups.
 *
 * The one view that answers the question grouping actually raises — "which
 * group has no Battle Shout?" — by putting the gaps in a column an eye runs
 * down. Buffs nobody in the raid can bring at all are dropped: eight empty
 * cells for a class the guild didn't bring is noise, and the raid strip already
 * says the class is absent.
 */
export function PartyBuffMatrix({ view }: { view: BoardView }) {
  const rows = PARTY_BUFFS.map((buff) => ({
    buff,
    cells: view.groups.map((g) => g.coverage.find((c) => c.buff.id === buff.id)!),
  })).filter((r) => r.cells.some((c) => c.state !== "missing"));

  if (rows.length === 0) return null;

  const populated = view.groups.filter((g) => g.members.length > 0).map((g) => g.number);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Party buffs by group</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 text-left font-medium">Buff</th>
                {view.groups.map((g) => (
                  <th
                    key={g.number}
                    className={cn(
                      "px-1 py-1 text-center font-medium",
                      !populated.includes(g.number) && "opacity-40",
                    )}
                  >
                    G{g.number}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ buff, cells }) => (
                <tr key={buff.id} className="border-t">
                  <td className="py-1 pr-2 whitespace-nowrap" title={buff.effect}>
                    {buffLabel(buff)}
                  </td>
                  {cells.map((cover, i) => (
                    <td key={i} className="px-1 py-1 text-center">
                      <span
                        title={buffTitle(cover)}
                        className={cn(
                          "inline-flex h-5 w-5 items-center justify-center rounded",
                          CELL_STYLE[cover.state],
                          view.groups[i].members.length === 0 && "opacity-40",
                        )}
                      >
                        {cover.state === "covered" ? "✓" : cover.state === "conditional" ? "?" : "·"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          ✓ someone in the group brings it · ? someone could — spec unconfirmed, or it&apos;s one
          they have to choose between (a shaman gets one totem per element) · · nobody. Buffs no
          one in the raid can bring are left out.
        </p>
      </CardContent>
    </Card>
  );
}

const classColor = (wowClass: string | undefined) =>
  wowClass && wowClass in CLASS_TEXT_COLORS ? CLASS_TEXT_COLORS[wowClass as WowClass] : undefined;

function ProviderList({ cover }: { cover: BuffCoverage }) {
  const shown = cover.providers.length > 0 ? cover.providers : cover.possible;
  if (shown.length === 0) {
    const needs = [...new Set(cover.buff.sources.map((s) => s.wowClass))];
    return (
      <span className="text-muted-foreground/70">
        {cover.buff.openTo ? cover.buff.openTo : needs.length > 0 ? `needs ${needs.join(" / ")}` : "—"}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-x-1.5">
      {shown.slice(0, 4).map((p) => (
        <span key={p.name} style={{ color: classColor(p.wowClass) }}>
          {p.name}
        </span>
      ))}
      {shown.length > 4 && <span className="text-muted-foreground">+{shown.length - 4}</span>}
    </span>
  );
}

/**
 * Raid-wide and on-the-boss buffs — the coverage grouping can't change.
 *
 * Split by scope rather than merged into one list, because the two carry
 * different consequences: a missing raid buff means an absent class, while a
 * missing boss debuff often means a present class that nobody assigned.
 */
export function RaidBuffPanel({ view }: { view: BoardView }) {
  const scopes: BuffScope[] = ["raid", "target"];
  const missing = view.raid.filter((c) => c.state === "missing").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Raid-wide{" "}
          <span className="font-normal text-muted-foreground">
            — {view.raid.length - missing} of {view.raid.length} covered
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {scopes.map((scope) => {
          const rows = view.raid.filter((c) => c.buff.scope === scope);
          if (rows.length === 0) return null;
          return (
            <div key={scope} className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">{SCOPE_LABELS[scope]}</h3>
              <ul className="space-y-0.5 text-xs">
                {rows.map((cover) => (
                  <li
                    key={cover.buff.id}
                    className="flex items-baseline justify-between gap-2 border-b border-dashed py-0.5 last:border-0"
                    title={buffTitle(cover)}
                  >
                    <span
                      className={cn(
                        "whitespace-nowrap",
                        cover.state === "missing" && "text-muted-foreground/60",
                      )}
                    >
                      {cover.state === "covered" ? "✓" : cover.state === "conditional" ? "?" : "·"}{" "}
                      {buffLabel(cover.buff)}
                    </span>
                    <span className="text-right text-[11px]">
                      <ProviderList cover={cover} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
