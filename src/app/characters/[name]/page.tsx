import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { Repo } from "@/lib/data/repo";
import type { SlotItem } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { PhasePills } from "@/components/phase-pills";
import { SlotGrid, type SlotRowView } from "@/components/slot-grid";
import { CharacterPhaseTabs, type PhaseTabView } from "@/components/character-phase-tabs";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { EmptyState } from "@/components/empty-state";
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
import { Button } from "@/components/ui/button";

type Params = { name: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return { title: decoded.charAt(0).toUpperCase() + decoded.slice(1) };
}

async function toItemRef(repo: Repo, slot: SlotItem): Promise<ItemRef> {
  const cached = await repo.getItem(slot.itemId);
  return {
    itemId: slot.itemId,
    name: cached?.name ?? slot.itemName,
    quality: cached?.quality,
    icon: cached?.icon,
  };
}

export default async function CharacterPage({ params }: { params: Promise<Params> }) {
  const { name } = await params;
  const repo = await getRepo();
  const [guild, bundle] = await Promise.all([
    repo.getGuild(),
    repo.getCharacterBundle(decodeURIComponent(name)),
  ]);
  if (!bundle) notFound();
  const { character, current, wishlists, awards, summary } = bundle;

  const slotRows: SlotRowView[] = current
    ? await Promise.all(
        current.slots.map(async (s) => ({
          slot: s.slot,
          item: await toItemRef(repo, s),
          enchant: s.enchant?.name,
          gems: s.gems?.map((g) => g.name),
        })),
      )
    : [];

  const tabs: PhaseTabView[] = await Promise.all(
    wishlists.map(async (view) => ({
      phase: view.phase,
      setName: view.set.name,
      source: view.set.source,
      importedAt: view.set.importedAt,
      completion: view.completion,
      statDeltas: view.statDeltas,
      rows: await Promise.all(
        view.rows.map(async (row) => ({
          slot: row.slot,
          wished: await toItemRef(repo, row.wished),
          current: row.current ? await toItemRef(repo, row.current) : undefined,
          state: row.state,
          awardedAt: row.awardedAt,
        })),
      ),
    })),
  );

  const hasAnything = current !== undefined || wishlists.length > 0 || awards.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span style={{ color: CLASS_TEXT_COLORS[character.class] }}>{character.name}</span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            {character.race && <span>{character.race}</span>}
            <ClassBadge wowClass={character.class} spec={character.spec} />
            <RoleBadge role={character.role} />
            {character.status === "alt" && <Badge variant="muted">alt</Badge>}
            {character.note && <span className="text-xs">· {character.note}</span>}
          </span>
        }
      >
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <PhasePills
              items={summary.completionByPhase.map((c) => ({ phase: c.phase, pct: c.completion.pct }))}
              activePhase={guild.activePhase}
            />
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/characters/${encodeURIComponent(character.name.toLowerCase())}/performance`}
              >
                <Activity className="h-3.5 w-3.5" /> Performance
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/characters/${encodeURIComponent(character.name.toLowerCase())}/edit`}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {summary.totalAwards} items won
            {summary.offspecAwards > 0 && ` (${summary.offspecAwards} off-spec)`}
            {summary.lastAwardAt &&
              ` · last ${format(parseISO(summary.lastAwardAt), "d MMM yyyy")}`}
          </p>
        </div>
      </PageHeader>

      {!hasAnything ? (
        <EmptyState
          title={`Nothing imported for ${character.name} yet`}
          description="Import a SixtyUpgrades set as current gear or a phase wishlist to populate this profile."
          action={
            <Button asChild size="sm">
              <Link href={`/admin/import?character=${encodeURIComponent(character.name)}`}>
                Import for {character.name}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Current gear</CardTitle>
            </CardHeader>
            <CardContent>
              {current ? (
                <>
                  <SlotGrid slots={slotRows} />
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Imported {format(parseISO(current.importedAt), "d MMM yyyy")} · source: {current.source}
                    {current.sourceUrl && (
                      <>
                        {" · "}
                        <a href={current.sourceUrl} className="underline" target="_blank" rel="noreferrer">
                          open set
                        </a>
                      </>
                    )}
                    {" · "}
                    <Link
                      href={`/admin/import?character=${encodeURIComponent(character.name)}&kind=current`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Update current gear
                    </Link>
                  </p>
                </>
              ) : (
                <EmptyState
                  title="No current gear imported"
                  description="Import a SixtyUpgrades set marked as “current” to enable stat comparisons and equipped-status tracking."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/admin/import?character=${encodeURIComponent(character.name)}&kind=current`}
                      >
                        Import current gear
                      </Link>
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-3">
            <CharacterPhaseTabs
              tabs={tabs}
              activePhase={guild.activePhase}
              hasCurrent={current !== undefined}
              characterName={character.name}
            />
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Loot history</CardTitle>
          <p className="text-xs text-muted-foreground">
            Everything awarded to {character.name} via Gargul, matched against their wishlists.
          </p>
        </CardHeader>
        <CardContent>
          {awards.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No items awarded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Raid</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="w-28">Wishlist</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {awards.map((a) => (
                  <TableRow key={a.award.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {format(parseISO(a.award.awardedAt), "d MMM yyyy")}
                    </TableCell>
                    <TableCell>
                      <ItemLink
                        item={{
                          itemId: a.award.itemId,
                          name: a.item?.name ?? a.award.itemName,
                          quality: a.item?.quality,
                          icon: a.item?.icon,
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.session.zones.join(" + ")}
                    </TableCell>
                    <TableCell>
                      {a.award.offspec ? (
                        <Badge variant="warning">Off-spec</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Main spec</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.wishlist.matched ? (
                        <Badge variant="success">
                          {a.wishlist.phases.map((p) => `P${p}`).join(", ")} wishlist
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.award.note ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
