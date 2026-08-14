import Link from "next/link";
import { format, parseISO } from "date-fns";
import { UserRound } from "lucide-react";
import type { CorrectionEntry } from "@/lib/analysis/corrections-log";
import {
  correctedRaiders,
  correctionAuthor,
  groupCorrections,
} from "@/lib/analysis/corrections-log";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The consumable corrections log — who changed what a raid says a raider used.
 *
 * Grouped by the save that made them, because that is the act being recorded:
 * an officer works down a night's consumables and writes once, and eight lines
 * for one decision scroll the rest of the log off the page.
 *
 * A server component, and the raider filter is a set of links rather than a
 * picker, for the reason the rest of this app puts selection in the URL: a
 * filtered view is a thing you can send to the person it is about. "Here is
 * every correction anyone has made against you" should be a link.
 */
export function CorrectionsLog({
  entries,
  all,
  raider,
}: {
  /** Already filtered — what the log renders. */
  entries: CorrectionEntry[];
  /** Every correction, for building the filter. */
  all: CorrectionEntry[];
  /** The active raider filter, if any. */
  raider?: string;
}) {
  const raiders = correctedRaiders(all);
  const active = raider?.trim().toLowerCase();
  const batches = groupCorrections(entries);

  if (all.length === 0) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            Nobody has corrected a consumable count yet. When an officer changes what a raid says a
            raider got through, it is recorded here with their name and the reason they gave.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {raiders.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Raider</span>
          <FilterLink
            label={`Everyone (${all.length})`}
            href="/guild/audit?tab=corrections"
            active={!active}
          />
          {raiders.map((name) => (
            <FilterLink
              key={name}
              label={name}
              href={`/guild/audit?tab=corrections&raider=${encodeURIComponent(name)}`}
              active={active === name.toLowerCase()}
            />
          ))}
        </div>
      )}

      <Card>
        <CardContent className="py-4">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections against {raider}.</p>
          ) : (
            <ul className="space-y-4">
              {batches.map((batch, i) => {
                const author = correctionAuthor(batch);
                return (
                  <li
                    key={`${batch.code}-${batch.at}-${i}`}
                    className="border-b pb-5 last:border-0"
                  >
                    {/* The batch line spans the card: who on the left, which
                        night and when pushed to the right edge, so the header
                        frames the corrections under it instead of trailing off
                        into empty space. */}
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {/* Responsibility is the point of this log, so it leads. */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          author.known
                            ? "bg-secondary text-secondary-foreground"
                            : "border border-dashed text-muted-foreground",
                        )}
                        title={
                          author.known
                            ? `${author.name} made this correction`
                            : "Recorded before this app kept the officer's name — corrections made from now on carry one"
                        }
                      >
                        <UserRound className="h-3 w-3" />
                        {author.name}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        corrected{" "}
                        <strong className="font-medium text-foreground">
                          {batch.entries.length}
                        </strong>{" "}
                        {batch.entries.length === 1 ? "line" : "lines"}
                      </span>
                      <span className="ml-auto flex items-baseline gap-2 text-xs text-muted-foreground">
                        <Link
                          href={`/logs?report=${batch.code}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {batch.raid ?? batch.code}
                        </Link>
                        {batch.raidAt && <span>{format(parseISO(batch.raidAt), "d MMM")}</span>}
                        <span className="tabular-nums">
                          {format(parseISO(batch.at), "d MMM yyyy HH:mm")}
                        </span>
                      </span>
                    </div>

                    <ul className="mt-2 space-y-0.5 border-l pl-3">
                      {batch.entries.map((entry, j) => (
                        <li
                          key={`${entry.actorName}-${entry.name}-${j}`}
                          /* Columns from md up, so the reason gets the width it
                             has always needed and stops hiding under the
                             consumable. Below that it wraps as one block. */
                          className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm py-0.5 text-sm md:grid md:grid-cols-[2.5rem_10rem_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-x-3"
                        >
                          <Badge
                            variant={entry.delta > 0 ? "success" : "destructive"}
                            className="justify-center md:w-full"
                          >
                            {entry.delta > 0 ? "+" : "−"}
                            {Math.abs(entry.delta)}
                          </Badge>
                          <span className="truncate font-medium" title={entry.actorName}>
                            {entry.actorName}
                          </span>
                          <span className="truncate text-muted-foreground" title={entry.name}>
                            {entry.name}
                          </span>
                          <span className="min-w-0 text-xs text-muted-foreground">
                            {entry.note ?? (
                              <span className="text-muted-foreground/40">No reason given</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
