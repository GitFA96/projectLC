import { PawPrint } from "lucide-react";
import type { PetSpendLine, PetSpendView } from "@/lib/types";
import { Raider } from "@/components/logs/rank-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const gold = (n: number) => `${Math.round(n).toLocaleString("en-US")}g`;

/**
 * Pet consumables, as a range rather than a number.
 *
 * Its own card, below the ranking and outside it. The gold table charges what
 * the cast stream recorded, and for a pet that is a floor: feeding and
 * scrolling happen between pulls, where the log holds no events (see
 * `analysis/pet-consumables.ts`). So this says what was charged, what keeping
 * the same consumables up all night would cost, and leaves the difference
 * visible instead of quietly picking one — **nothing here moves the ranking
 * above, and it must not start to.** That is §5 and the council's call, and
 * folding an estimate into the totals would also have to move the career and
 * season pages in the same change or the same night reads two ways.
 *
 * Priced by the caller with the raid's own `costPerUse`, so a scroll costs what
 * the officer said it costs this week and not a default from months ago.
 */
export function PetSpendCard({
  view,
  costPerUse,
}: {
  view: PetSpendView;
  costPerUse: Record<string, number>;
}) {
  const priced = view.rows
    .map((row) => {
      const loggedGold = row.lines.reduce((s, l) => s + (costPerUse[l.name] ?? 0) * l.logged, 0);
      const maintainedGold = row.lines.reduce(
        (s, l) => s + (costPerUse[l.name] ?? 0) * l.maintained,
        0,
      );
      return { row, loggedGold, maintainedGold };
    })
    .sort((a, b) => b.maintainedGold - a.maintainedGold || b.loggedGold - a.loggedGold);

  const loggedTotal = priced.reduce((s, p) => s + p.loggedGold, 0);
  const maintainedTotal = priced.reduce((s, p) => s + p.maintainedGold, 0);
  const hours = (n: number) => (n === 1 ? "hour" : `${n} hours`);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <PawPrint className="h-4 w-4 text-info" />
          Pet consumables
          {view.rows.length > 0 && (
            <span className="text-sm font-normal text-muted-foreground">
              ≈ {gold(loggedTotal)} charged, up to {gold(maintainedTotal)} if they were kept up
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Pets are fed and scrolled <em>between</em> pulls, and a log holds no out-of-combat time —
          so the cast stream catches only some of it and the ranking above charges only what it
          caught. <strong>Charged</strong> is that count. <strong>Kept up</strong> is the other end:
          a pet food every {hours(view.windowHours.food)} and a scroll every{" "}
          {hours(view.windowHours.scroll)} across a{" "}
          {view.spanHours > 0 ? `${view.spanHours.toFixed(1)}-hour` : "whole"} night, the same
          windows a raider&apos;s own food and scrolls are re-bought on. The real figure is
          somewhere between, and only the hunter knows where — this card is for asking them.
        </p>
      </CardHeader>
      <CardContent>
        {priced.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Nothing was logged on a pet this raid — which is not the same as nobody bringing
            anything. Warcraft Logs types every pet, totem and treant alike, so an empty card is
            what &quot;no evidence&quot; looks like.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Raider</TableHead>
                <TableHead className="w-20 text-right" title="What the log recorded, and what the ranking above already charges">
                  Charged
                </TableHead>
                <TableHead className="w-20 text-right" title="What keeping the same consumables up for the whole night would cost">
                  Kept up
                </TableHead>
                <TableHead className="w-20 text-right" title="What keeping them up would add — nobody is charged for this today">
                  Gap
                </TableHead>
                <TableHead>What the pet had</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priced.map(({ row, loggedGold, maintainedGold }) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <Raider name={row.name} slug={row.slug} className={row.className} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {gold(loggedGold)}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {gold(maintainedGold)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-warn-ink">
                    {maintainedGold - loggedGold < 0.5 ? (
                      <span className="text-muted-foreground/40">—</span>
                    ) : (
                      `+${gold(maintainedGold - loggedGold)}`
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
                      {row.lines.map((line) => (
                        <PetLine key={line.name} line={line} />
                      ))}
                    </span>
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

/**
 * One consumable, with both counts on it.
 *
 * A line the cast stream never explained is marked rather than hidden: it is a
 * scroll somebody bought that nothing in this app has ever charged for, and it
 * carries no count of its own — a pet re-entering play republishes its whole
 * aura set, so sightings count summons, not items.
 */
function PetLine({ line }: { line: PetSpendLine }) {
  const unseen = line.logged === 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={unseen ? "warning" : "secondary"} className="font-normal">
        {line.name}
      </Badge>
      <span className="text-xs tabular-nums text-muted-foreground">
        {unseen ? (
          <span title="The pet was seen holding it, with no cast to explain it — never charged">
            seen, never charged
          </span>
        ) : (
          <>×{line.logged}</>
        )}
        {line.maintained > line.logged && (
          <span className="ml-1 text-warn-ink" title="What keeping it up all night would take">
            → ×{line.maintained}
          </span>
        )}
      </span>
    </span>
  );
}
