import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, GitCompareArrows, Pencil } from "lucide-react";
import { format, parseISO } from "date-fns";
import { getRepo } from "@/lib/data/repo";
import { AttendanceDetail } from "@/components/performance/attendance-detail";
import { buildLoggedGear, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import {
  LOGGED_GEAR_RAIDS,
  loggedSlotOptions,
  type LoggedSlotOption,
} from "@/lib/analysis/current-gear";
import { buildAwardContext } from "@/lib/loot/award-context";
import { sameSpec } from "@/lib/utils";
import { CLASS_TEXT_COLORS } from "@/lib/constants/wow";
import type { Repo } from "@/lib/data/repo";
import type { SlotId, SlotItem } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { ClassBadge } from "@/components/class-badge";
import { RoleBadge } from "@/components/role-badge";
import { SpecBadge } from "@/components/spec-badge";
import { ProfessionBadges, ProfessionGapBadge } from "@/components/profession-badge";
import { WeekDots } from "@/components/week-dots";
import { PhasePills } from "@/components/phase-pills";
import { SlotGrid, type SlotRowView } from "@/components/slot-grid";
import { LoggedGearSummary } from "@/components/logged-gear-summary";
import { GearSourcePicker, type GearSourceOption } from "@/components/gear-source-picker";
import {
  ResetPinnedSlotsButton,
  type CurrentSlotOptionView,
} from "@/components/current-slot-picker";
import { CharacterPhaseTabs, type PhaseTabView } from "@/components/character-phase-tabs";
import type { ItemRef } from "@/components/item-link";
import { CharacterComments } from "@/components/character-comments";
import { AwardItemButton, type AwardContext } from "@/components/award-item-controls";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { LootHistoryTable, type LootHistoryRow } from "@/components/loot-history-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { can, canSeeCharacter } from "@/lib/auth/can";
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

/** The set they imported — the other answer to "what are they wearing". */
const SET_KEY = "set";

/** "20 Jul · Serpentshrine Cavern" — one raid night, as the picker names it. */
function nightLabel(report: { startTime: string; zone?: string; title: string }): string {
  return `${format(parseISO(report.startTime), "d MMM")} · ${report.zone ?? report.title}`;
}

export default async function CharacterPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * Gated at "member", then again per character below.
   *
   * `roster.view` cannot be the gate on its own: a raider must be able to reach
   * **their own** character without it, because seeing your own record is
   * ownership rather than a grant — express it as a capability and a guild
   * master can switch it off by accident, taking away the reason a raider signs
   * in at all. `canSeeCharacter` is that rule, and it needs the character, so
   * the second half waits until the bundle is loaded.
   */
  const access = await pageView("member", { returnTo: "/roster" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const [{ name }, sp] = await Promise.all([params, searchParams]);
  const repo = await getRepo();
  const [guild, bundle, sessions, performance, items, roster] = await Promise.all([
    repo.getGuild(),
    repo.getCharacterBundle(decodeURIComponent(name)),
    repo.listRaidSessions(),
    repo.getCharacterPerformance(decodeURIComponent(name)),
    repo.listItems(),
    repo.listCharacters(),
  ]);
  if (!bundle) notFound();
  if (!canSeeCharacter(access.viewer, bundle.character.id)) {
    return <NoAccess reason="This page needs the “See the roster” permission, unless it is your own character." />;
  }
  const { character, current, wishlists, awards, summary, comments, currentOverrides, importedCurrent } =
    bundle;

  const award: AwardContext = buildAwardContext(character, guild, sessions);

  /*
   * Correcting a recorded award is the ledger's write, offered here because
   * this is where a wrong row gets noticed. Only the picker is shipped to the
   * client — the winner list, not the roster summaries behind it.
   */
  const canEditAwards = can(access.viewer, "loot.award");
  /* Re-dating an award is a separate grant — see `loot.amend`. */
  const canAmendAwards = can(access.viewer, "loot.amend");
  const awardRoster = canEditAwards
    ? roster.map((c) => ({ id: c.character.id, name: c.character.name, wowClass: c.character.class }))
    : [];

  /*
   * The loot ledger for this character, flattened for the client.
   *
   * Every field is a join already done above — the item cache's name for the
   * id, the night's zones, the edit dialog's target. The table itself only
   * pages; building the rows here keeps that component free of the repo and
   * ships one shape instead of five.
   */
  const lootHistory: LootHistoryRow[] = awards.map((a) => ({
    id: a.award.id,
    awardedAt: a.award.awardedAt,
    item: {
      itemId: a.award.itemId,
      name: a.item?.name ?? a.award.itemName,
      quality: a.item?.quality,
      icon: a.item?.icon,
    },
    raid: a.session.zones.join(" + "),
    offspec: a.award.offspec,
    wishlist: a.wishlist,
    note: a.award.note,
    edit: {
      mode: "edit",
      raidSessionId: a.session.id,
      sessionLabel: a.session.zones.join(" + "),
      sessionDate: a.session.date,
      award: {
        awardedAt: a.award.awardedAt,
        id: a.award.id,
        itemId: a.award.itemId,
        itemName: a.item?.name ?? a.award.itemName,
        winnerName: a.character?.name ?? a.award.rawWinnerName,
        winnerCharacterId: a.award.characterId ?? undefined,
        external: a.award.external,
        offspec: a.award.offspec,
        note: a.award.note,
      },
    },
  }));

  const itemsById = new Map(items.map((i) => [i.id, i] as const));
  const pinnedSlotIds = new Set(bundle.currentOverrides.map((o) => o.item.slot));
  const slotRows: SlotRowView[] = current
    ? await Promise.all(
        current.slots.map(async (s) => ({
          slot: s.slot,
          item: await toItemRef(repo, s),
          enchant: s.enchant?.name,
          gems: s.gems?.map((g) => g.name),
          pinned: pinnedSlotIds.has(s.slot),
        })),
      )
    : [];

  // What they wore, summarised per slot: every item seen in each slot over the
  // recent raid nights, plus each of those nights on its own.
  const loggedReports: LoggedGearReport[] = (performance?.reports ?? []).map((r) => ({
    report: r.report,
    rows: r.rows,
  }));
  const recent = buildLoggedGear(loggedReports, { limit: LOGGED_GEAR_RAIDS });
  const gearOptions: GearSourceOption[] = [
    ...(current
      ? [
          {
            key: SET_KEY,
            group: "Imported set",
            label: `Sourced: ${current.source === "sixtyupgrades" ? "SixtyUpgrades" : current.source}`,
            triggerLabel: `Sourced: ${current.source === "sixtyupgrades" ? "SixtyUpgrades" : current.source}`,
          },
        ]
      : []),
    ...(recent.pulls > 0
      ? [
          {
            key: "recent",
            group: "From the logs",
            label: `Last ${recent.reports.length} raid${recent.reports.length === 1 ? "" : "s"}`,
            triggerLabel: `Logged — last ${recent.reports.length} raid${recent.reports.length === 1 ? "" : "s"}`,
          },
        ]
      : []),
    ...recent.reports.map((r) => ({
      key: `log:${r.code}`,
      group: "From the logs",
      label: nightLabel(r),
      triggerLabel: `Logged — ${nightLabel(r)}`,
    })),
  ];
  const requestedGear = Array.isArray(sp.gear) ? sp.gear[0] : sp.gear;
  // The logs lead when there are any — they're the livelier answer, and the
  // imported set is one click away.
  const activeGear =
    gearOptions.find((o) => o.key === requestedGear)?.key ??
    (recent.pulls > 0 ? "recent" : SET_KEY);
  const activeNight = activeGear.startsWith("log:")
    ? recent.reports.find((r) => r.code === activeGear.slice(4))
    : undefined;
  const activeView =
    activeGear === "recent"
      ? recent
      : activeNight
        ? buildLoggedGear(loggedReports.filter((r) => r.report.code === activeNight.code))
        : undefined;

  // What the "Currently" column can be set to: the items this character was
  // logged wearing in each slot (its pair included), which slots an officer has
  // already pinned, and what the import said before they did.
  const pinnedSlots = new Set<SlotId>(currentOverrides.map((o) => o.item.slot));
  const importedBySlot = new Map((importedCurrent?.slots ?? []).map((s) => [s.slot, s] as const));
  const slotOptions = loggedSlotOptions(recent);
  /** The log's reading of an item, topped up from the item cache. */
  const optionView = (option: LoggedSlotOption): CurrentSlotOptionView => {
    const cached = itemsById.get(option.itemId);
    return {
      ...option,
      name: cached?.name ?? option.name,
      icon: cached?.icon ?? option.icon,
      quality: cached?.quality ?? option.quality,
    };
  };

  const tabs: PhaseTabView[] = await Promise.all(
    wishlists.map(async (view) => ({
      phase: view.phase,
      setName: view.set.name,
      source: view.set.source,
      importedAt: view.set.importedAt,
      completion: view.completion,
      statDeltas: view.statDeltas,
      rows: await Promise.all(
        view.rows.map(async (row) => {
          const options = (slotOptions.get(row.slot) ?? []).map(optionView);
          const pinned = pinnedSlots.has(row.slot);
          const imported = importedBySlot.get(row.slot);
          return {
            slot: row.slot,
            wished: await toItemRef(repo, row.wished),
            current: row.current ? await toItemRef(repo, row.current) : undefined,
            state: row.state,
            awardedAt: row.awardedAt,
            awardId: row.awardId,
            awardedVia: row.awardedVia,
            alternatives: await Promise.all(
              row.alternatives.map(async (a) => ({
                itemId: a.itemId,
                item: await toItemRef(repo, {
                  slot: row.slot,
                  itemId: a.itemId,
                  // The stored name is a fallback for an item the cache has
                  // never resolved; toItemRef prefers the cache when it has one.
                  itemName: a.itemName ?? `Item #${a.itemId}`,
                }),
                rank: a.rank,
                note: a.note,
              })),
            ),
            // No logged gear and nothing pinned means there's nothing to pick
            // from — the cell stays the plain read-only item it always was.
            currentPick:
              options.length > 0 || pinned
                ? {
                    pinned,
                    imported: imported ? await toItemRef(repo, imported) : undefined,
                    options,
                  }
                : undefined,
          };
        }),
      ),
    })),
  );

  const hasAnything =
    current !== undefined || wishlists.length > 0 || awards.length > 0 || recent.pulls > 0;

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
            {/* Full names here — the header has the room the roster cell
                doesn't, and this is where somebody comes to check. */}
            <ProfessionBadges professions={character.professions} />
            {summary.professionGap && (
              <ProfessionGapBadge gap={summary.professionGap} characterName={character.name} />
            )}
            <RoleBadge role={character.role} />
            {character.offSpec && (
              <Badge variant="muted" title="Second spec they raid in — recorded by an officer">
                off-spec:{" "}
                <SpecBadge spec={character.offSpec} wowClass={character.class} className="ml-0.5" />
                {character.offSpecRole && (
                  <span className="ml-1 text-[10px]">({character.offSpecRole})</span>
                )}
              </Badge>
            )}
            {/* Only a warning when the logs show a spec the roster doesn't know
                about at all — an off-spec night is expected, not an error. */}
            {summary.loggedSpec &&
              !sameSpec(summary.loggedSpec, character.spec) &&
              !sameSpec(summary.loggedSpec, character.offSpec) && (
                <Badge
                  variant="warning"
                  title="Spec seen in their most recent logs matches neither their main spec nor a recorded off-spec"
                >
                  logs:{" "}
                  <SpecBadge spec={summary.loggedSpec} wowClass={character.class} className="ml-0.5" />
                </Badge>
              )}
            {character.status === "alt" &&
              (summary.mainCharacterName ? (
                <Badge variant="muted">
                  alt of{" "}
                  <Link
                    href={`/characters/${encodeURIComponent(summary.mainCharacterName.toLowerCase())}`}
                    className="ml-0.5 font-medium underline-offset-2 hover:underline"
                  >
                    {summary.mainCharacterName}
                  </Link>
                </Badge>
              ) : (
                <Badge variant="muted" title="Marked as an alt, but no main is set — set one on the edit page">
                  alt
                </Badge>
              ))}
            {character.status === "pug" && (
              <Badge variant="muted" title="Known off-roster player — excluded from roster KPIs and fairness stats">
                pug
              </Badge>
            )}
            {character.status === "inactive" && <Badge variant="muted">inactive</Badge>}
            {summary.altNames && summary.altNames.length > 0 && (
              <span className="text-xs text-muted-foreground" title="Alts that list this character as their main">
                alts:{" "}
                {summary.altNames.map((alt, i) => (
                  <span key={alt}>
                    {i > 0 && ", "}
                    <Link
                      href={`/characters/${encodeURIComponent(alt.toLowerCase())}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {alt}
                    </Link>
                  </span>
                ))}
              </span>
            )}
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
              <Link href={`/compare?chars=${encodeURIComponent(character.name.toLowerCase())}`}>
                <GitCompareArrows className="h-3.5 w-3.5" /> Compare
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
            {summary.attendance && summary.attendance.raidsAttended > 0 && (
              <>
                {" · "}
                <AttendanceDetail attendance={summary.attendance} className="align-middle">
                  <span>
                    raided {summary.attendance.scoreAttended}/{summary.attendance.scoreTracked}{" "}
                    {summary.attendance.scoreBasis === "week" ? "reset weeks" : "logged raids"}
                    {summary.attendance.scorePct !== undefined && ` (${summary.attendance.scorePct}%)`}
                    <WeekDots weeks={summary.attendance.weeks} className="mx-1 align-middle" />
                  </span>
                </AttendanceDetail>
              </>
            )}
          </p>
        </div>
      </PageHeader>

      {!hasAnything ? (
        <EmptyState
          title={`Nothing imported for ${character.name} yet`}
          description="Import a SixtyUpgrades set as current gear or a phase wishlist to populate this profile."
          action={
            <Button asChild size="sm">
              <Link href={`/guild/import?character=${encodeURIComponent(character.name)}`}>
                Import for {character.name}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>{activeView ? "Gear worn" : "Gear"}</CardTitle>
                {gearOptions.length > 1 && (
                  <GearSourcePicker options={gearOptions} value={activeGear} className="w-full" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {activeView ? (
                  <>
                    Everything worn across{" "}
                    {activeNight ? (
                      <>one raid night ({nightLabel(activeNight)})</>
                    ) : (
                      <>
                        {activeView.reports.length} raid night
                        {activeView.reports.length === 1 ? "" : "s"} (
                        {format(
                          parseISO(activeView.reports[activeView.reports.length - 1].startTime),
                          "d MMM",
                        )}
                        –{format(parseISO(activeView.reports[0].startTime), "d MMM yyyy")})
                      </>
                    )}{" "}
                    — {activeView.pulls} logged pull{activeView.pulls === 1 ? "" : "s"}. A slot with
                    more than one item is a swap; hover any item for its enchant and gems.
                  </>
                ) : current ? (
                  <>
                    {importedCurrent ? (
                      <>
                        The SixtyUpgrades set imported{" "}
                        {format(parseISO(importedCurrent.importedAt), "d MMM yyyy")} — what they
                        built, not necessarily what they raided in.
                      </>
                    ) : (
                      <>
                        Built slot by slot from their logged gear — nothing has been imported for{" "}
                        {character.name} yet.
                      </>
                    )}
                    {importedCurrent?.sourceUrl && (
                      <>
                        {" · "}
                        <a
                          href={importedCurrent.sourceUrl}
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          open set
                        </a>
                      </>
                    )}
                    {" · "}
                    <Link
                      href={`/guild/import?character=${encodeURIComponent(character.name)}&kind=current`}
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Update
                    </Link>
                  </>
                ) : (
                  "Nothing imported and nothing logged yet."
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentOverrides.length > 0 ? (
                  <>
                    {currentOverrides.length} slot{currentOverrides.length === 1 ? "" : "s"} set by
                    hand — those win over the imported set wherever loot is judged.
                  </>
                ) : (
                  <>Every slot currently comes from the imported set.</>
                )}{" "}
                <Link
                  href={`/characters/${encodeURIComponent(character.name.toLowerCase())}/edit`}
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  Edit slots
                </Link>
                <ResetPinnedSlotsButton
                  characterName={character.name}
                  count={currentOverrides.length}
                />
              </p>
            </CardHeader>
            <CardContent>
              {activeView ? (
                <LoggedGearSummary view={activeView} itemsById={itemsById} />
              ) : current ? (
                <SlotGrid slots={slotRows} />
              ) : (
                <EmptyState
                  title="No gear to show yet"
                  description="Import a SixtyUpgrades set marked as “current” for stat comparisons and equipped-status tracking, or import a Warcraft Logs report to read gear straight off their pulls."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/guild/import?character=${encodeURIComponent(character.name)}&kind=current`}
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
              // Stat deltas only ever diff stat blocks SixtyUpgrades computed —
              // pinned slots move items, never numbers.
              hasCurrent={importedCurrent !== undefined}
              characterName={character.name}
              characterId={character.id}
              award={award}
            />
          </div>
        </div>
      )}

      <CharacterComments
        characterId={character.id}
        characterName={character.name}
        comments={comments}
      />

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Loot history</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything awarded to {character.name} — imported from Gargul or entered by hand —
              matched against their wishlists.
            </p>
          </div>
          <AwardItemButton ctx={award} label="Award an item" variant="default" />
        </CardHeader>
        <CardContent>
          <LootHistoryTable
            rows={lootHistory}
            roster={awardRoster}
            canEdit={canEditAwards}
            canAmend={canAmendAwards}
          />
        </CardContent>
      </Card>
    </div>
  );
}
