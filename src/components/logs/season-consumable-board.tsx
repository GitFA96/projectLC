"use client";

import * as React from "react";
import { Coins, FlaskConical, Info } from "lucide-react";
import type { SeasonConsumableStat } from "@/lib/types";
import { sharedCastNote } from "@/lib/wcl/consumables";
import {
  ALL_KEY,
  buildOptions,
  matches,
  parseKey,
  usersOf,
} from "@/components/logs/season-consumable-picker";
import { RankBadge, Raider } from "@/components/logs/rank-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { compareText } from "@/lib/sort";

const gold = (n: number) => `${Math.round(n).toLocaleString("en-US")}g`;

/**
 * The season's consumables from the consumable's side: pick one (or a whole
 * family) and see every player who used it, ranked.
 *
 * **Only players with at least one use are listed.** Who *didn't* is a
 * different question and a harder one — a mage with no haste potions is playing
 * their class, not skipping their consumables — and answering it would mean
 * this table deciding who ought to use what. That is the council's call, so the
 * board ranks and totals, and never grades.
 */
export function SeasonConsumableBoard({
  consumables,
  raidCount,
}: {
  consumables: SeasonConsumableStat[];
  /** Raids currently selected — the denominator for the raid-wide average. */
  raidCount: number;
}) {
  const [key, setKey] = React.useState<string>(ALL_KEY);
  // A total view by default: the raid got through what it got through, and the
  // pug who came once drank real potions. The spend ranking answers the other
  // question and starts on the guild instead.
  const [guildOnly, setGuildOnly] = React.useState(false);
  const [metric, setMetric] = React.useState<"uses" | "gold">("uses");

  const sel = React.useMemo(() => parseKey(key), [key]);
  const rows = React.useMemo(
    () =>
      usersOf(consumables, sel, guildOnly).sort(
        (a, b) => (metric === "gold" ? b.gold - a.gold : b.uses - a.uses) || compareText(a.name, b.name),
      ),
    [consumables, sel, guildOnly, metric],
  );

  const totalUses = rows.reduce((s, r) => s + r.uses, 0);
  const totalGold = rows.reduce((s, r) => s + r.gold, 0);
  const perRaid = raidCount > 0 ? Math.round((totalUses / raidCount) * 10) / 10 : 0;
  /* Only meaningful for one consumable — see the note on `raids` in the type. */
  const single = sel.kind === "name" ? consumables.find((c) => c.name === sel.name) : undefined;
  /*
   * What the selection can't tell apart. A label that stands for two items has
   * to say so where its number is read, not only where it's curated — but not
   * under "all consumables", where one potion's ambiguity says nothing about
   * the twenty thousand uses on screen and is only noise.
   */
  const notes =
    sel.kind === "all"
      ? []
      : consumables
          .filter((c) => matches(sel, c.name))
          .map((c) => sharedCastNote(c.name))
          .filter((n): n is string => n !== undefined);

  const options = React.useMemo(() => buildOptions(consumables), [consumables]);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-success-ink" />
              Consumable usage
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick a consumable — or a whole family — and see everyone who used it, with their own
              per-raid average.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              <Button
                type="button"
                variant={guildOnly ? "ghost" : "default"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setGuildOnly(false)}
              >
                All players
              </Button>
              <Button
                type="button"
                variant={guildOnly ? "default" : "ghost"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setGuildOnly(true)}
              >
                Guild only
              </Button>
            </div>
            <div className="flex rounded-md border p-0.5">
              <Button
                type="button"
                variant={metric === "gold" ? "ghost" : "default"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setMetric("uses")}
              >
                Uses
              </Button>
              <Button
                type="button"
                variant={metric === "gold" ? "default" : "ghost"}
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs"
                onClick={() => setMetric("gold")}
              >
                <Coins className="h-3.5 w-3.5" /> Gold
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={key} onValueChange={setKey}>
            <SelectTrigger className="w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.key} value={item.key}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">
              {totalUses.toLocaleString("en-US")}
            </span>{" "}
            uses · <span className="tabular-nums">{perRaid}</span> /raid ·{" "}
            <span className="tabular-nums">{rows.length}</span> player{rows.length === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums">{gold(totalGold)}</span>
            {single && (
              <>
                {" "}
                · used in{" "}
                <span className="tabular-nums">
                  {single.raids} of {raidCount}
                </span>{" "}
                raids
              </>
            )}
          </p>
        </div>
        {notes.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            <span>{notes.join(" ")}</span>
          </p>
        )}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Nobody used this in the selected raids.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Raider</TableHead>
                <TableHead className="w-16 text-right">Raids</TableHead>
                <TableHead className="w-16 text-right">Uses</TableHead>
                <TableHead className="w-16 text-right">/ raid</TableHead>
                <TableHead className="w-20 text-right">Gold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow
                  key={r.name}
                  className={cn(i === 0 && "bg-warn-soft/70 hover:bg-warn-soft/70")}
                >
                  <TableCell>
                    <RankBadge rank={i + 1} />
                  </TableCell>
                  <TableCell>
                    <Raider name={r.name} slug={r.slug} className={r.className} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {r.raids}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      metric === "uses" && "font-semibold",
                    )}
                  >
                    {r.uses.toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{r.perRaid}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right text-sm tabular-nums",
                      metric === "gold" ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {gold(r.gold)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
