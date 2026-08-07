import type { Metadata } from "next";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { FlaskConical } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { simConfigured } from "@/lib/sim/run";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { SimSpecView, WowClass } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sim" };

/**
 * The sim section starts at a class and spec, not at a raider.
 *
 * A wowsims setup describes a SPEC — its rotation, the buffs and consumables it
 * is expected to run — and almost nothing about the person playing it, since the
 * gear, talents and fight length come from whichever pull you pick. Entering
 * through one raider's profile made that backwards: the feature was invisible
 * unless you already knew whose page to open, and every raider needed their own
 * pasted link before they could be simmed at all.
 *
 * Every spec this guild has actually raided is listed, whether or not a setup
 * exists — a spec with none reads as work to do rather than as absent.
 */

/** Warcraft Logs' class strings match ours where we have a colour for them. */
function classColor(wowClass: string): string | undefined {
  return CLASS_TEXT_COLORS[wowClass as WowClass];
}

function bySpec(specs: SimSpecView[]): { wowClass: string; specs: SimSpecView[] }[] {
  const byClass = new Map<string, SimSpecView[]>();
  for (const s of specs) byClass.set(s.wowClass, [...(byClass.get(s.wowClass) ?? []), s]);
  return [...byClass]
    .map(([wowClass, list]) => ({
      wowClass,
      specs: [...list].sort((a, b) => b.kills - a.kills || a.spec.localeCompare(b.spec)),
    }))
    .sort((a, b) => a.wowClass.localeCompare(b.wowClass));
}

export default async function SimIndexPage() {
  const repo = await getRepo();
  const specs = await repo.listSimSpecs();
  const configured = simConfigured();
  const withProfile = specs.filter((s) => s.hasProfile).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" /> Sim
          </span>
        }
        description={
          <>
            One wowsims setup per spec, run against a real pull&apos;s gear, talents and length —
            so the answer is &ldquo;what would perfect play have produced, that night, in that
            kit&rdquo;. Pick a spec, then the raider, the boss and the night.
            {specs.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                {withProfile} of {specs.length} specs set up.
              </span>
            )}
          </>
        }
      />

      {!configured && (
        <p className="rounded-md border border-warn-line bg-warn-soft p-3 text-xs text-warn-ink">
          No simulator configured. Download <code className="font-mono">wowsimcli</code> from the{" "}
          <a
            href="https://github.com/wowsims/tbc-new"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            wowsims releases page
          </a>{" "}
          and point <code className="font-mono">WOWSIMCLI_PATH</code> at it in{" "}
          <code className="font-mono">.env.local</code>, then restart the dev server. Setups can be
          pasted either way; nothing will run until the binary is there.
        </p>
      )}

      {specs.length === 0 ? (
        <EmptyState
          title="No logged specs yet"
          description="Specs appear here once a Warcraft Logs report is imported — every class and spec someone killed a boss as gets a row, whether or not it has a sim setup."
        />
      ) : (
        <div className="space-y-4">
          {bySpec(specs).map(({ wowClass, specs: list }) => (
            <section key={wowClass} className="space-y-2">
              <h2
                className="text-sm font-semibold"
                style={{ color: classColor(wowClass) }}
              >
                {wowClass}
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((s) => (
                  <Link
                    key={s.spec}
                    href={`/sim/${encodeURIComponent(s.wowClass)}/${encodeURIComponent(s.spec)}`}
                    className="block"
                  >
                    <Card className="h-full transition-colors hover:border-foreground/30 hover:bg-accent/40">
                      <CardContent className="space-y-1.5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium">{s.spec}</span>
                          <Badge variant={s.hasProfile ? "success" : "outline"}>
                            {s.hasProfile ? "setup saved" : "no setup"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {s.kills === 0 ? (
                            "no logged kills on this spec"
                          ) : (
                            <>
                              {s.kills} kill{s.kills === 1 ? "" : "s"} ·{" "}
                              {s.raiders.length} raider{s.raiders.length === 1 ? "" : "s"}
                              {s.lastKillAt && ` · last ${format(parseISO(s.lastKillAt), "d MMM")}`}
                            </>
                          )}
                        </p>
                        {s.raiders.length > 0 && (
                          <p
                            className={cn(
                              "truncate text-xs",
                              s.hasProfile ? "text-foreground/70" : "text-muted-foreground/70",
                            )}
                            title={s.raiders.map((r) => `${r.actorName} (${r.kills})`).join(", ")}
                          >
                            {s.raiders.slice(0, 4).map((r) => r.actorName).join(", ")}
                            {s.raiders.length > 4 && ` +${s.raiders.length - 4}`}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Specs come from the pulls themselves — boss kills only, since a wipe has no number worth
        comparing and the sim never wipes. Where Warcraft Logs left a kill unlabelled, the spec is
        recovered from the talent build using the naming the logs supplied on pulls they did label,
        so a raider is never quietly missing from a spec they demonstrably played.
      </p>
    </div>
  );
}
