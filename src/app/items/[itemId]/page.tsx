import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { format, parseISO } from "date-fns";
import { ExternalLink } from "lucide-react";
import { getRepo } from "@/lib/data/repo";
import Link from "next/link";
import { ItemCurationEditor } from "@/components/loot/item-curation-editor";
import { ItemPriorityEditor } from "@/components/loot/priority-editor";
import { AwardDecisionNote } from "@/components/loot/award-decision";
import { ItemComments, type ItemCommentTarget } from "@/components/loot/item-comments";
import { buildAwardContext, buildAwardTarget } from "@/lib/loot/award-context";
import { QUALITY_TEXT_COLORS, SLOT_LABELS, wowheadItemUrl, type SlotId } from "@/lib/constants/wow";
import { ItemIcon } from "@/components/item-icon";
import { CharacterLink, ClassBadge } from "@/components/class-badge";
import { AwardItemButton, AwardToAnyoneButton } from "@/components/award-item-controls";
import {
  ContenderTable,
  PriorityScore,
  type ContenderView,
} from "@/components/loot/contender-table";
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
import type { ItemRef } from "@/components/item-link";
import type { Repo } from "@/lib/data/repo";
import type { SlotItem } from "@/lib/types";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

type Params = { itemId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { itemId } = await params;
  const repo = await getRepo();
  const item = await repo.getItem(Number(itemId));
  return { title: item?.name ?? `Item #${itemId}` };
}

/** Resolve a "currently using" item against the cache, for the client table. */
async function toItemRef(repo: Repo, slot: SlotItem): Promise<ItemRef & { slot: SlotId }> {
  const cached = await repo.getItem(slot.itemId);
  return {
    // The slot rides along because it, not the item id, is what's unique: a
    // raider can wear the same trinket twice.
    slot: slot.slot,
    itemId: slot.itemId,
    name: cached?.name ?? slot.itemName,
    quality: cached?.quality,
    icon: cached?.icon,
  };
}

export default async function ItemPage({ params }: { params: Promise<Params> }) {
  const access = await pageView("loot.view", { returnTo: "/items" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { itemId: itemIdRaw } = await params;
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const repo = await getRepo();
  const [contention, guild, sessions, weights, comments, roster, allItems] = await Promise.all([
    repo.getItemContention(itemId),
    repo.getGuild(),
    repo.listRaidSessions(),
    repo.getLootPriorityWeights(),
    repo.listItemComments(itemId),
    repo.listCharacters(),
    repo.listItems(),
  ]);
  if (!contention) notFound();
  const { item, itemName, wishers, awards, openCount } = contention;
  const quality = item?.quality ?? "common";
  const received = awards.filter((a) => !a.award.offspec && a.award.characterId !== null).length;
  const prefill = { itemId, name: itemName, quality: item?.quality, icon: item?.icon };
  const top = wishers.find((w) => w.rank === 1);

  const commentTargetsById = new Map<string, ItemCommentTarget>();
  for (const w of wishers) commentTargetsById.set(w.character.id, { id: w.character.id, name: w.character.name });
  for (const a of awards) {
    if (a.character) commentTargetsById.set(a.character.id, { id: a.character.id, name: a.character.name });
  }
  const commentTargets = [...commentTargetsById.values()].sort((a, b) => compareText(a.name, b.name));

  // Zones the cache already uses, so a hand-curated source spells them the
  // same way the loot plan groups them.
  const knownZones = [...new Set(allItems.map((i) => i.source?.zone).filter((z): z is string => !!z))].sort();

  // Every character, not just the ones who wanted it — see AwardToAnyoneButton.
  const awardCandidates = roster
    .map((r) => ({ id: r.character.id, name: r.character.name }))
    .sort((a, b) => compareText(a.name, b.name));

  const contenders: ContenderView[] = await Promise.all(
    wishers.map(async (w) => ({
      characterId: w.character.id,
      name: w.character.name,
      wowClass: w.character.class,
      spec: w.character.spec,
      role: w.character.role,
      status: w.character.status,
      rank: w.rank,
      satisfied: w.satisfied,
      phases: w.phases,
      listRank: w.listRank,
      priorityTier: w.priorityTier,
      priorityTierLabel: w.priorityTierLabel,
      priority: w.priority,
      onSpecAwardsActivePhase: w.onSpecAwardsActivePhase,
      awardsThisPhase: w.awardsThisPhase,
      totalOnSpecAwards: w.totalOnSpecAwards,
      attendance: w.metrics?.attendance,
      career: w.metrics?.career,
      goldPerRaid: w.metrics?.goldPerRaid,
      currentInSlot: await Promise.all(w.currentInSlot.map((s) => toItemRef(repo, s))),
    })),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <ItemIcon icon={item?.icon} quality={quality} size={48} />
        <div className="min-w-0">
          <h1
            className="text-xl font-semibold tracking-tight"
            data-wowhead={`item=${itemId}&domain=tbc`}
          >
            <span style={{ color: QUALITY_TEXT_COLORS[quality] }}>{itemName}</span>
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="capitalize">{quality}</span>
            {item?.slot && <span>· {SLOT_LABELS[item.slot]}</span>}
            {item?.source && (
              <span>
                · {item.source.boss ? `${item.source.boss} — ` : ""}
                {item.source.zone}
              </span>
            )}
            <ItemCurationEditor
              itemId={itemId}
              phase={item?.phase}
              source={item?.source}
              knownZones={knownZones}
            />
            <a
              href={wowheadItemUrl(itemId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
            >
              Wowhead <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">{wishers.length} want</Badge>
          <Badge variant="success" className="tabular-nums">{received} received</Badge>
          <Badge variant={openCount > 0 ? "warning" : "muted"} className="tabular-nums">
            {openCount} open
          </Badge>
        </div>
      </div>

      {top && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Top of the list
          </span>
          <CharacterLink name={top.character.name} wowClass={top.character.class} />
          <ClassBadge wowClass={top.character.class} spec={top.character.spec} />
          <PriorityScore priority={top.priority} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {top.priority?.factors
              .filter((f) => f.score !== undefined)
              .map((f) => f.detail)
              .join(" · ")}
          </span>
          <AwardItemButton
            ctx={buildAwardContext(top.character, guild, sessions)}
            prefill={prefill}
            label={`Award to ${top.character.name}`}
            variant="default"
          />
        </div>
      )}

      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Who should get it</CardTitle>
          <ItemPriorityEditor itemName={itemName} rule={contention.priorityRule} />
          {contention.manualTiers.length > 0 && (
            <p className="rounded-md bg-warn-soft px-2 py-1.5 text-xs text-warn-ink">
              The sheet puts{" "}
              {contention.manualTiers.map((tier, i) => (
                <span key={tier}>
                  {i > 0 && ", then "}
                  <strong>{tier}</strong>
                </span>
              ))}{" "}
              above everything below — that&apos;s a call for the council, not the app, so nobody is
              ranked into it.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            The sheet&apos;s spec priority decides the order; the score below only breaks ties
            inside a rung. It weighs attendance ({weights.attendance}%), loot owed this phase (
            {weights.lootDebt}%), median parse ({weights.performance}%) and preparation (
            {weights.preparation}%), then adjusts for roster standing and slots already filled. A
            metric nobody has logged yet is left out of the average rather than counted as zero —
            hover a score for the full arithmetic.{" "}
            <Link href="/" className="font-medium text-foreground underline-offset-2 hover:underline">
              Change the weighting
            </Link>{" "}
            on the guild page.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {contenders.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {contention.altWishers.length > 0
                ? "Only alts have this on a wishlist."
                : "No one has this on a wishlist."}
            </p>
          ) : (
            <ContenderTable
              contenders={contenders}
              awardTarget={buildAwardTarget(guild, sessions)}
              prefill={prefill}
              activePhase={guild.activePhase}
              hasChain={contention.priorityRule !== undefined}
            />
          )}
          {contention.altWishers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Also listed by{" "}
              <span className="font-medium text-foreground">
                {contention.altWishers.join(", ")}
              </span>{" "}
              — {contention.altWishers.length === 1 ? "an alt, so it doesn't" : "alts, so they don't"}{" "}
              contend here. Loot goes to the person&apos;s main.
            </p>
          )}
        </CardContent>
      </Card>

      <ItemComments
        itemId={itemId}
        itemName={itemName}
        comments={comments}
        contenders={commentTargets}
      />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Award history</CardTitle>
          {/* The contenders above can be awarded from their own rows. This is
              for everyone else: a drop Gargul missed, or a piece won in a raid
              this tracker never saw. */}
          <AwardToAnyoneButton
            target={buildAwardTarget(guild, sessions)}
            candidates={awardCandidates}
            prefill={prefill}
          />
        </CardHeader>
        <CardContent>
          {awards.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Never awarded — has not dropped yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Winner</TableHead>
                  <TableHead>Raid</TableHead>
                  <TableHead className="w-24">Type</TableHead>
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
                      {a.character ? (
                        <CharacterLink name={a.character.name} wowClass={a.character.class} />
                      ) : (
                        <Badge
                          variant={a.award.external ? "muted" : "warning"}
                          title={
                            a.award.external
                              ? "Off roster (disenchanted / bank / PUG)"
                              : "Not matched to a roster character — resolve it in the loot ledger"
                          }
                        >
                          {a.award.rawWinnerName}
                        </Badge>
                      )}
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
                    <TableCell className="text-xs text-muted-foreground">{a.award.note ?? ""}</TableCell>
                  </TableRow>
                ))}
                {/* The reasoning, under the row it belongs to. Only for awards
                    that came from the board — the rest have none to show. */}
                {awards
                  .filter((a) => a.award.decision)
                  .map((a) => (
                    <TableRow key={`${a.award.id}-why`} className="hover:bg-transparent">
                      <TableCell colSpan={5} className="pt-0">
                        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Why {a.character?.name ?? a.award.rawWinnerName} got it
                        </span>
                        <AwardDecisionNote decision={a.award.decision} />
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
