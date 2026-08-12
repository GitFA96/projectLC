import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import { PHASE_IDS } from "@/lib/constants/wow";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { PrioritySheetView } from "@/components/loot/priority-sheet-view";
import { PrioritySheetEditor } from "@/components/loot/priority-sheet-editor";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
export const metadata: Metadata = { title: "Priority sheet" };

/**
 * The council's spec priority sheet, whole — one phase at a time.
 *
 * The item page answers "what applies to this drop", but only for drops the
 * tracker has heard of; most of a sheet covers items nobody has wishlisted or
 * won yet. This is the document itself, with officer edits folded in, and the
 * place a new phase's sheet is pasted.
 */
export default async function PrioritySheetPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string }>;
}) {
  const access = await pageView("priority.view", { returnTo: "/loot/priority" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { phase: phaseParam } = await searchParams;
  const repo = await getRepo();
  const guild = await repo.getGuild();

  const asked = Number(phaseParam);
  const phase = PHASE_IDS.includes(asked as (typeof PHASE_IDS)[number]) ? asked : guild.activePhase;
  const sheet = await repo.getPrioritySheet(phase);

  return (
    <div>
      <PageHeader
        title={`Phase ${phase} priority sheet`}
        description="The council's written spec priority, exactly as the sheet says it — with any officer edits shown over the top. Edit a single chain here or on the item's own page; replace the whole sheet above."
      >
        {sheet.ruleCount > 0 && <Badge variant="outline">{sheet.ruleCount} items</Badge>}
        {sheet.officerCount > 0 && (
          <Badge variant="secondary">{sheet.officerCount} officer-edited</Badge>
        )}
        <Link
          href="/loot"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Loot ledger
        </Link>
      </PageHeader>

      <nav className="mb-4 flex flex-wrap items-center gap-1.5" aria-label="Phase">
        {PHASE_IDS.map((p) => (
          <Link
            key={p}
            href={`/loot/priority?phase=${p}`}
            className={cn(
              "rounded-md border px-2.5 py-1 text-sm font-medium transition-colors hover:bg-accent",
              p === phase && "border-transparent bg-primary text-primary-foreground hover:bg-primary",
            )}
          >
            P{p}
            {p === guild.activePhase && (
              <span className={cn("ml-1.5 text-xs", p === phase ? "opacity-80" : "text-muted-foreground")}>
                active
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="mb-4">
        <PrioritySheetEditor
          phase={phase}
          origin={sheet.origin}
          markdown={sheet.markdown}
          author={sheet.author}
          updatedAt={sheet.updatedAt}
        />
        {sheet.sheetNote && (
          <p className="mt-2 text-xs text-muted-foreground">Note: {sheet.sheetNote}</p>
        )}
      </div>

      {/*
        The empty state turns on "this phase has no sheet", not "there is
        nothing to show". Officer item rules are guild-wide, so a phase nobody
        has written a sheet for still has rows to render — and letting those
        suppress the empty state hid the one fact the officer came for.
      */}
      {sheet.ruleCount === 0 ? (
        <EmptyState
          className="mb-4"
          title={`No sheet for phase ${phase} yet`}
          description="Paste the council's document above and every contested drop in this phase starts ranking against it. Until then, items fall back to the metric score alone."
        />
      ) : (
        <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
          <strong>A &gt; B</strong> puts A strictly above B; <strong>A = B</strong> ranks them
          equally. A contender lands in the first tier they satisfy, and the metric score only
          breaks ties <em>inside</em> a tier. Amber rungs are judgement calls the sheet is asking a
          human to make — nobody is ranked into them.
        </p>
      )}

      {(sheet.ruleCount > 0 || sheet.unlisted.length > 0) && (
        <PrioritySheetView sections={sheet.sections} unlisted={sheet.unlisted} />
      )}
    </div>
  );
}
