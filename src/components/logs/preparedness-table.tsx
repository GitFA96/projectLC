"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { Raider } from "@/components/logs/rank-bits";
import {
  SCALE_MAX,
  SCALE_MIN,
  SCALE_STEP,
  changeScale,
  useTextScale,
} from "@/components/logs/use-text-scale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import type {
  PetSpendView,
  PreparednessPet,
  PreparednessPull,
  PreparednessRow,
  PreparednessSwap,
  PreparednessView,
  RaidFight,
} from "@/lib/types";
import { cn } from "@/lib/utils";

import { extrasPct, hasOwnWeaponBuff } from "@/lib/analysis/preparation";
import { compareText } from "@/lib/sort";

/**
 * What every raider brought, pull by pull.
 *
 * The shape this takes is decided by one fact about raid nights: they are not
 * one state. On a real report roughly half the roster is fed on some pulls and
 * not on others, lets a weapon buff lapse, or runs scrolls for part of the
 * evening — so a tick-or-cross per raider would have to pick one of two true
 * answers, and a "this varied" warning icon would light up half the table and
 * tell nobody anything.
 *
 * So the cell **is** the consistency: one pip per pull, left to right in pull
 * order, and the share beside it. Where the gaps fall is then readable in the
 * same glance as how many there were, with no second indicator competing for
 * attention.
 *
 * Every strip states its share as a **percentage**, in the same unit as the
 * Prepared column, because that column is a compound of two of them and "0%
 * prepared" is only actionable once you can see which half failed. Two of the
 * headers are marked as the ones it is made of; the rest are facts read beside
 * it and deliberately not scored — a weapon buff is set by any temporary
 * enchant, Windfury and fishing lures included, and pet is logged once for the
 * night rather than per pull.
 *
 * Scope down to a single pull and that ambiguity disappears with it — one pull
 * has exactly one honest answer per cell — so the strips give way to the
 * consumables themselves, with their icons and Wowhead tooltips.
 */

/** Which column orders the table, and which way. */
type Sort = { by: "name" | "prepared" | "extras"; dir: "asc" | "desc" };

/** The URL parameter holding the scope, so a scoped view is a link. */
export const PREP_SCOPE_PARAM = "prep";

/**
 * The scope lives in the URL, not in state.
 *
 * Officers paste these at each other — "look at Vashj pull 2" is the whole
 * point of scoping down — so the view has to survive being copied out of the
 * address bar. `replace` rather than `push`: stepping through pulls shouldn't
 * bury the page in back-button history.
 */
export function PreparednessPanel(props: Omit<Props, "scope" | "onScopeChange">) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const scope = search.get(PREP_SCOPE_PARAM) ?? "all";

  function onScopeChange(next: string) {
    const params = new URLSearchParams(search);
    if (next === "all") params.delete(PREP_SCOPE_PARAM);
    else params.set(PREP_SCOPE_PARAM, next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return <PreparednessTable {...props} scope={scope} onScopeChange={onScopeChange} />;
}

interface Props {
  view: PreparednessView;
  /**
   * The night's pet consumables, logged and estimated — the same view the gold
   * tab prices, so the two tabs can never quote different counts for the same
   * hunter. Scope-independent on purpose: a pet is fed once for the night.
   */
  petSpend: PetSpendView;
  fights: RaidFight[];
  reportCode: string;
  itemsByName: Record<string, ItemRef>;
  /**
   * Temporary weapon-enchant id → what it is.
   *
   * The log records that the weapon carried an enchantment and its id, never
   * the item; the enchant dictionary turns most of those ids into a name
   * ("Superior Wizard Oil"), and the sharpening stones into effect text. An id
   * nobody has looked up yet stays an id.
   */
  enchantNames: Record<number, string>;
  scope: string;
  onScopeChange: (next: string) => void;
}

export function PreparednessTable({
  view,
  petSpend,
  fights,
  reportCode,
  /**
   * Consumable name (lowercased, punctuation stripped) → the cache's item.
   *
   * Warcraft Logs names a flask and never says which item it was, so an icon
   * and a Wowhead tooltip need the cache to have matched the name to an id.
   * Anything it hasn't renders as its plain name — the same rule the priority
   * sheets follow, and the reason the import page offers to resolve them.
   */
  itemsByName,
  enchantNames,
  scope,
  onScopeChange,
}: Props) {
  const [sort, setSort] = React.useState<Sort>({ by: "name", dir: "asc" });
  const textScale = useTextScale();

  /* Raider → item → what keeping it up all night takes. See `PetTally`. */
  const petEstimate = React.useMemo(
    () =>
      new Map(
        petSpend.rows.map((row) => [
          row.name.toLowerCase(),
          new Map(row.lines.map((l) => [l.name, l.maintained] as const)),
        ]),
      ),
    [petSpend.rows],
  );

  /* Encounters in pull order, each with the pulls it took. */
  const encounters = React.useMemo(() => {
    const byName = new Map<string, RaidFight[]>();
    for (const fight of fights) {
      const list = byName.get(fight.encounterName) ?? [];
      list.push(fight);
      byName.set(fight.encounterName, list);
    }
    return [...byName.entries()].map(([name, list]) => ({ name, fights: list }));
  }, [fights]);

  /* `all`, an encounter name, or `fight:<id>` for one attempt. */
  const selectedFightId = scope.startsWith("fight:") ? Number(scope.slice(6)) : undefined;
  const selectedEncounter =
    selectedFightId !== undefined
      ? fights.find((f) => f.fightId === selectedFightId)?.encounterName
      : scope === "all"
        ? undefined
        : scope;

  const inScope = React.useMemo(() => {
    if (selectedFightId !== undefined) return fights.filter((f) => f.fightId === selectedFightId);
    if (selectedEncounter !== undefined) {
      return fights.filter((f) => f.encounterName === selectedEncounter);
    }
    return fights;
  }, [fights, selectedEncounter, selectedFightId]);

  const scopeIds = React.useMemo(() => new Set(inScope.map((f) => f.fightId)), [inScope]);
  const single = inScope.length === 1;

  /** Boss name for a pull id — the notes name the pull they are about. */
  const fightName = React.useCallback(
    (fightId: number) =>
      fights.find((f) => f.fightId === fightId)?.encounterName ?? `pull ${fightId}`,
    [fights],
  );

  /** Click a header to order by it; click again to flip direction. */
  const sortBy = (by: Sort["by"]) =>
    setSort((current) =>
      current.by === by
        ? { by, dir: current.dir === "asc" ? "desc" : "asc" }
        : { by, dir: by === "name" ? "asc" : "desc" },
    );

  /** Enchant id → name, for telling a bought oil from somebody else's totem. */
  const enchantNameOf = React.useCallback(
    (id: number): string | undefined => enchantNames[id],
    [enchantNames],
  );

  const rows = React.useMemo(() => {
    const scoped = view.rows.map((row) => {
      const pulls = row.pulls.filter((p) => scopeIds.has(p.fightId));
      const prepared = pulls.filter((p) => p.prepared).length;
      return {
        row,
        pulls,
        byFight: new Map(pulls.map((p) => [p.fightId, p] as const)),
        // Undefined, not zero: a raider who was on none of these pulls has no
        // figure, and a 0% they never earned reads as the worst in the room.
        preparedPct: pulls.length === 0 ? undefined : Math.round((prepared / pulls.length) * 100),
        // Scored into nothing — see `extrasPct`. Asked of the analysis layer
        // rather than counted here, so the rule has one home.
        extras: extrasPct(pulls, enchantNameOf),
        scrollPulls: pulls.filter((p) => p.scrolls.length > 0).length,
        ownWeaponPulls: pulls.filter((p) => hasOwnWeaponBuff(p, enchantNameOf)).length,
      };
    });
    return scoped.sort((a, b) => {
      if (sort.by === "name") {
        const byName = compareText(a.row.name, b.row.name);
        return sort.dir === "asc" ? byName : -byName;
      }
      const av = sort.by === "extras" ? a.extras : a.preparedPct;
      const bv = sort.by === "extras" ? b.extras : b.preparedPct;
      // Raiders with no pulls in scope sit at the bottom either way.
      if (av === undefined || bv === undefined) {
        return (
          (av === undefined ? 1 : 0) - (bv === undefined ? 1 : 0) ||
          compareText(a.row.name, b.row.name)
        );
      }
      return (sort.dir === "desc" ? bv - av : av - bv) || compareText(a.row.name, b.row.name);
    });
  }, [view.rows, scopeIds, sort, enchantNameOf]);

  if (view.rows.length === 0) {
    return (
      <EmptyState
        title="No preparation rows on this report"
        description="This raid has no per-player pulls to read. Re-fetch it once Warcraft Logs has finished parsing."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preparedness</CardTitle>
        <p className="text-xs text-muted-foreground">
          What every raider brought, pull by pull. Reads the same pulls the list above leaves
          switched on — {inScope.length} of {fights.length}. <strong>Pet</strong> is the
          exception: it is logged once for the night, so it does not narrow with the scope.
        </p>
        <PetTally view={petSpend} />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ScopePill active={scope === "all"} onClick={() => onScopeChange("all")}>
            All pulls
            <Count n={fights.length} />
          </ScopePill>
          {encounters.map((encounter) => (
            <ScopePill
              key={encounter.name}
              active={selectedEncounter === encounter.name}
              onClick={() => onScopeChange(encounter.name)}
            >
              {encounter.name}
              {encounter.fights.length > 1 && <Count n={encounter.fights.length} />}
            </ScopePill>
          ))}
          <TextSize scale={textScale} />
        </div>

        {/* One boss, several attempts: the second row steps into a single pull,
            which is what turns the strips into named consumables. */}
        {selectedEncounter !== undefined && (
          <PullPicker
            encounter={selectedEncounter}
            fights={fights.filter((f) => f.encounterName === selectedEncounter)}
            scope={scope}
            onScopeChange={onScopeChange}
          />
        )}
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="relative w-full overflow-x-auto">
          {/* `w-max min-w-full` fills the card when the night is narrow and
              lets it grow when the names need the room — the wrapper scrolls.
              Under plain `w-full` the columns squeeze until `truncate` ellipsises
              a name, and half a consumable name is not a consumable name:
              "Scroll of Agility …" drops the rank, which is the difference
              between an 8g scroll and a 1g one.
              `zoom` scales the whole table — text, icons, pips and padding
              together — so shrinking it really does buy width back, which a
              font-size alone would not: these cells are sized in rem. How much
              sideways scroll is worth reading is then the reader's call.
              For the same reason the multi-item cells stack one item per line
              instead of wrapping: a flask beside an elixir reflows differently
              in every row, and reading down a column of names beats hunting for
              where the second one landed. Width is the thing we spend, and the
              wrapper already scrolls. */}
          <table className="w-max min-w-full caption-bottom text-sm" style={{ zoom: textScale }}>

            <thead className="[&_tr]:border-b">
              <tr>
                <Th>
                  <SortHeader sort={sort} column="name" onClick={() => sortBy("name")}>
                    Raider
                  </SortHeader>
                </Th>
                <Th>
                  <Scored>Flask / elixirs</Scored>
                </Th>
                <Th>
                  <Scored>Food</Scored>
                </Th>
                <Th>Scrolls</Th>
                <Th title="A fact beside the score, not part of it — any temporary enchant sets this, Windfury Totem and fishing lures included.">
                  Weapon buff
                </Th>
                <Th title="Logged once for the night, so it has no per-pull percentage and does not narrow with the scope.">
                  Pet
                </Th>
                <Th className="text-center">Enchants</Th>
                <Th className="text-right">Gems</Th>
                <Th className="text-right">iLvl</Th>
                <Th className="text-right">
                  <SortHeader
                    sort={sort}
                    column="prepared"
                    onClick={() => sortBy("prepared")}
                    align="right"
                  >
                    Prepared
                  </SortHeader>
                </Th>
                <Th className="text-right">
                  <SortHeader
                    sort={sort}
                    column="extras"
                    onClick={() => sortBy("extras")}
                    align="right"
                  >
                    Extras
                  </SortHeader>
                </Th>
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {rows.map(({ row, pulls, byFight, preparedPct, extras, scrollPulls, ownWeaponPulls }) => {
                const latest = pulls[pulls.length - 1];
                const only = single ? byFight.get(inScope[0].fightId) : undefined;
                return (
                  <tr key={row.name} className="border-b transition-colors hover:bg-muted/50">
                    <Td>
                      <span className="flex flex-col leading-tight">
                        <Raider name={row.name} slug={row.slug} className={row.className} />
                        <span className="text-[10px] text-muted-foreground">
                          {row.spec ?? ROLE_LABEL[row.role]}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <span className="flex flex-col items-start">
                        {single ? (
                          <Coverage pull={only} itemsByName={itemsByName} />
                        ) : (
                          <>
                            <Strip
                              fights={inScope}
                              byFight={byFight}
                              read={(p) =>
                                p.grade === "none" ? false : p.grade === "partial" ? "half" : true
                              }
                              // Amber pip either way; whether half a set counts is
                              // the council's coverage rule, so the % asks that.
                              counts={(p) => p.covered}
                            />
                            <PrepNotes pulls={pulls} fightName={fightName} />
                          </>
                        )}
                      </span>
                    </Td>
                    <Td>
                      {single ? (
                        only === undefined ? (
                          <Absent />
                        ) : only.food ? (
                          <Badge variant="success">Well Fed</Badge>
                        ) : (
                          <Nothing>not fed</Nothing>
                        )
                      ) : (
                        <Strip fights={inScope} byFight={byFight} read={(p) => p.food} />
                      )}
                    </Td>
                    <Td>
                      {single ? (
                        <Consumables names={only?.scrolls} itemsByName={itemsByName} />
                      ) : (
                        <Strip
                          fights={inScope}
                          byFight={byFight}
                          read={(p) => p.scrolls.length > 0}
                        />
                      )}
                    </Td>
                    <Td>
                      {single ? (
                        <WeaponBuff pull={only} enchantNames={enchantNames} />
                      ) : (
                        <Strip fights={inScope} byFight={byFight} read={(p) => p.weaponBuff} />
                      )}
                    </Td>
                    <Td>
                      <Pet
                        pet={row.pet}
                        scopeIds={scopeIds}
                        all={scope === "all"}
                        itemsByName={itemsByName}
                        estimate={petEstimate.get(row.name.toLowerCase())}
                      />
                    </Td>
                    <Td className="text-center">
                      <Enchants
                        pulls={pulls}
                        slots={view.enchantSlots}
                        name={row.name}
                        slug={row.slug}
                        reportCode={reportCode}
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {latest?.hasGear ? latest.gems : <Absent />}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <ItemLevel row={row} enchantNames={enchantNames} />
                    </Td>
                    <Td className="text-right">
                      {preparedPct === undefined ? (
                        <Badge variant="muted">–</Badge>
                      ) : (
                        <Badge
                          variant={
                            preparedPct >= 90
                              ? "success"
                              : preparedPct >= 60
                                ? "warning"
                                : "destructive"
                          }
                          title={
                            `Flask or elixirs AND food on ${preparedPct}% of ${pulls.length} pull${pulls.length === 1 ? "" : "s"} — the same rule the loot score reads. ` +
                            `Read it against the two ● columns: both have to hold on the same pull. ` +
                            `Weapon buff, scrolls and pet are not in it.`
                          }
                        >
                          {preparedPct}%
                        </Badge>
                      )}
                    </Td>
                    <Td className="text-right">
                      {extras === undefined ? (
                        <Badge variant="muted">–</Badge>
                      ) : (
                        <Badge
                          // Never red. A raider who buys no scrolls has not
                          // failed at anything — this only ever adds.
                          variant={extras === 0 ? "muted" : "info"}
                          title={
                            `Scroll on ${scrollPulls} of ${pulls.length}, own weapon buff on ${ownWeaponPulls} of ${pulls.length} — ` +
                            `${extras}% of the two extra slots each pull offers. ` +
                            `A Windfury Totem somebody else dropped does not count; a shaman's own imbue does. ` +
                            `Nothing scores this — it is credit, not a requirement.`
                          }
                        >
                          +{extras}%
                        </Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          {single ? (
            <span>One pull — every cell names what was actually up.</span>
          ) : (
            <>
              <Key className="bg-success">had it</Key>
              <Key className="bg-warn">half a set of elixirs</Key>
              <Key className="bg-muted-foreground/30">did not</Key>
              <Key className="bg-transparent ring-1 ring-inset ring-border">not on that pull</Key>
              <span>Pips read in pull order — hover one for the boss, or the % for the count.</span>
            </>
          )}
          <span>
            <span className="font-medium text-foreground">●</span> the two columns{" "}
            <strong>Prepared</strong> is made of — both on the same pull. Pet is logged for the
            night, not the pull.
          </span>
          <span>
            <strong className="text-info-ink">Extras</strong> is the other two — a scroll and a
            weapon buff they put on themselves — counted separately and scored into nothing. A
            Windfury Totem from somebody else&apos;s shaman is not one.
          </span>
          <span>
            <span className="font-medium text-warn-ink">△</span> changed during the night
          </span>
          <span>
            <span className="font-medium text-info-ink">⇄</span> swapped weapons (a fishing rod on
            Lurker, a resist set) — item level reads the most-worn gear
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const ROLE_LABEL = { tank: "Tank", healer: "Healer", dps: "DPS" } as const;

/**
 * Marks a column the Prepared figure is actually made of.
 *
 * Two of these columns are the score and four sit beside it, and once every
 * one of them carries a percentage that distinction stops being obvious — a
 * raider at 100% weapon buff and 0% food reads as mostly fine until you know
 * which number the loot council's rule reads. The marker is on the two that
 * count rather than the four that don't, because a badge saying "not scored"
 * four times reads as an apology.
 */
function Scored({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title="Part of the Prepared figure — flask or elixirs AND food, the rule the loot score reads"
    >
      {children}
      <span aria-hidden className="text-[9px] leading-none text-foreground/60">
        ●
      </span>
    </span>
  );
}

function Th({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      title={title}
      className={cn(
        "h-9 px-2 text-left align-middle text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn("px-2 py-1.5 align-middle", className)}>{children}</td>;
}

function Count({ n }: { n: number }) {
  return <span className="ml-1 tabular-nums opacity-60">{n}</span>;
}

function Absent() {
  return <span className="text-muted-foreground/50">–</span>;
}

function Nothing({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-danger-ink">{children}</span>;
}

function Key({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-1.5 rounded-[1.5px]", className)} />
      {children}
    </span>
  );
}

/** Same pill language as the report picker above it. */
function ScaleStep({ scale, by, label }: { scale: number; by: number; label: string }) {
  return (
    <button
      type="button"
      onClick={() => changeScale(by)}
      // Disabled at the ends rather than hidden, so the control keeps its shape
      // and the reader can see which way there is still room to go.
      disabled={by < 0 ? scale <= SCALE_MIN : scale >= SCALE_MAX}
      aria-label={by < 0 ? "Smaller text" : "Larger text"}
      className="cursor-pointer px-1.5 py-1 text-xs leading-none transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-30"
    >
      {label}
    </button>
  );
}

/**
 * Shrink or grow the table, so the reader decides about the scrollbar.
 *
 * Sits with the scope pills because it belongs to the same question — how much
 * of the night fits on the screen at once. The percentage is a button too: a
 * control that can only step is one a reader has to click five times to undo.
 */
function TextSize({ scale }: { scale: number }) {
  return (
    <span
      className="ml-auto inline-flex items-center rounded-full border"
      title="Text size for this table. Smaller fits more on screen; larger needs the sideways scroll."
    >
      <ScaleStep scale={scale} by={-SCALE_STEP} label="−" />
      <button
        type="button"
        onClick={() => changeScale()}
        aria-label="Reset text size to 100%"
        className="cursor-pointer border-x px-2 py-1 text-[11px] leading-none tabular-nums text-muted-foreground transition-colors hover:bg-accent"
      >
        {Math.round(scale * 100)}%
      </button>
      <ScaleStep scale={scale} by={SCALE_STEP} label="+" />
    </span>
  );
}
function ScopePill({

  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors hover:bg-accent",
        active && "border-foreground/30 bg-primary text-primary-foreground hover:bg-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * The attempts on one boss.
 *
 * Only worth a row when there were several: a boss killed first time has one
 * pull, and its own pill already selected it.
 */
function PullPicker({
  encounter,
  fights,
  scope,
  onScopeChange,
}: {
  encounter: string;
  fights: RaidFight[];
  scope: string;
  onScopeChange: (next: string) => void;
}) {
  if (fights.length < 2) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-2">
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {encounter}
      </span>
      <ScopePill active={scope === encounter} onClick={() => onScopeChange(encounter)}>
        All {fights.length} pulls
      </ScopePill>
      {fights.map((fight, index) => (
        <ScopePill
          key={fight.fightId}
          active={scope === `fight:${fight.fightId}`}
          onClick={() => onScopeChange(`fight:${fight.fightId}`)}
        >
          <span
            className={cn(
              "mr-1 inline-block h-1.5 w-1.5 rounded-full",
              fight.kill ? "bg-success" : "bg-warn",
            )}
          />
          Pull {index + 1} · {fight.kill ? "kill" : "wipe"}
        </ScopePill>
      ))}
    </div>
  );
}

/**
 * One pip per pull, in pull order.
 *
 * `read` returns true, false, or `"half"` for the one state that is neither —
 * a battle elixir with no guardian, which passes a lenient coverage bar while
 * still being half a set.
 */
/**
 * One pip per pull, with the share beside it.
 *
 * **A percentage, not a ratio.** The Prepared column is a percentage, and the
 * point of these is to decompose it — "0% prepared" against "flask 100%, food
 * 0%" is the answer to the question the compound figure raises, and two numbers
 * in different units can't be read against each other at a glance. The count
 * they came from is a hover away, because 100% of one pull is not 100% of
 * twelve.
 *
 * `counts` is how a column whose pips show a *fact* scores itself against the
 * *standard*: the flask strip paints a half set amber either way, but whether
 * half counts is `policy.preparation.coverage`'s call, not this component's.
 */
function Strip({
  fights,
  byFight,
  read,
  counts,
}: {
  fights: RaidFight[];
  byFight: Map<number, PreparednessPull>;
  read: (pull: PreparednessPull) => boolean | "half";
  /** What the percentage counts, when that isn't simply "the pip wasn't empty". */
  counts?: (pull: PreparednessPull) => boolean;
}) {
  let good = 0;
  let present = 0;
  const gaps: string[] = [];
  const pips = fights.map((fight) => {
    const pull = byFight.get(fight.fightId);
    if (pull === undefined) {
      return (
        <span
          key={fight.fightId}
          title={`${fight.encounterName} — not on this pull`}
          className="h-3.5 w-[5px] rounded-[1.5px] ring-1 ring-inset ring-border"
        />
      );
    }
    present++;
    const value = read(pull);
    if (counts ? counts(pull) : value !== false) good++;
    if (value === "half") gaps.push(`${fight.encounterName} (half)`);
    else if (!value) gaps.push(fight.encounterName);
    return (
      <span
        key={fight.fightId}
        title={`${fight.encounterName} — ${value === "half" ? "half a set" : value ? "yes" : "no"}`}
        className={cn(
          "h-3.5 w-[5px] rounded-[1.5px]",
          value === "half" ? "bg-warn" : value ? "bg-success" : "bg-muted-foreground/30",
        )}
      />
    );
  });

  const pct = present === 0 ? undefined : Math.round((good / present) * 100);
  return (
    <span
      className="inline-flex items-center"
      title={[
        `${good} of ${present} pull${present === 1 ? "" : "s"}`,
        gaps.length > 0 ? `gaps on: ${gaps.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join(" — ")}
    >
      <span className="inline-flex items-center gap-[2px]">{pips}</span>
      <span
        className={cn(
          "ml-1.5 text-[11px] tabular-nums text-muted-foreground",
          present > 0 && good === present && "text-success-ink",
          present > 0 && good === 0 && "text-danger-ink",
        )}
      >
        {pct === undefined ? "–" : `${pct}%`}
      </span>
    </span>
  );
}

/** Consumable name → the cache's item, when it knows one. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A consumable as an item where possible, and as its plain name otherwise.

 *
 * The fallback is the point: an icon and a Wowhead tooltip need an item id,
 * the log only ever gave us a name, and a name nobody has resolved is still
 * worth reading. Nothing here guesses an id.
 */
function Consumable({ name, itemsByName }: { name: string; itemsByName: Record<string, ItemRef> }) {
  const item = itemsByName[nameKey(name)];
  if (item === undefined) {
    return (
      <span className="text-xs" title="Not matched to an item yet — resolve names on the import page">
        {name}
      </span>
    );
  }
  return <ItemLink item={item} size="sm" />;

}

function Consumables({
  names,
  itemsByName,
}: {
  names?: string[];
  itemsByName: Record<string, ItemRef>;
}) {
  if (names === undefined) return <Absent />;
  if (names.length === 0) return <Nothing>none</Nothing>;
  return (
    <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
      {names.map((name) => (
        <Consumable key={name} name={name} itemsByName={itemsByName} />
      ))}
    </span>
  );

}

/** m:ss from the pull start, for a consumable that went up during it. */
function atMinute(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The two things a coverage pip cannot say, said as quietly as possible.
 *
 * **Mid-pull** — a flask or elixir that went up *during* the pull, on a raider
 * who did not have it at the start. Deliberately not called "late": on this
 * guild's logs most of these are Elixir of Demonslaying drunk in the opening
 * seconds of a demon boss, which is the correct play for an elixir that does
 * nothing anywhere else. The mark says *when*, and leaves what it means to the
 * officer reading it — who can now also see why a pull graded empty.
 *
 * **Second** — the same event on a raider who *did* have it at the start: they
 * drank another during the fight. Not a gap and not a failing, but it is a
 * second item bought and used, and it is the only place the table can say so.
 *
 * **Stacked** — elixirs on top of a flask, which already covered the pull on
 * its own. Not a better grade and deliberately not drawn as one; it is what
 * somebody chose to spend, and the gold tab is where that lands.
 *
 * Neither is scored, neither moves a percentage, and both render as nothing at
 * all when they do not apply — which is almost always. An empty `late` is also
 * what a report imported before this was fetched looks like (§1), so it is
 * never phrased as "nobody was late".
 */
function PrepNotes({ pulls, fightName }: { pulls: PreparednessPull[]; fightName: (id: number) => string }) {
  const late = pulls.filter((p) => p.lateConsumables.some((l) => !l.refill));
  const seconds = pulls.filter((p) => p.lateConsumables.some((l) => l.refill));
  const stacked = pulls.filter((p) => p.flask !== undefined && p.elixirs.length > 0);
  if (late.length === 0 && seconds.length === 0 && stacked.length === 0) return null;
  const describe = (list: PreparednessPull[], refill: boolean) =>
    list
      .map(
        (p) =>
          `${fightName(p.fightId)}: ${p.lateConsumables
            .filter((l) => Boolean(l.refill) === refill)
            .map((l) => `${l.name} at ${atMinute(l.atMs)}`)
            .join(", ")}`,
      )
      .join(" — ");
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] leading-tight text-muted-foreground/70">
      {late.length > 0 && (
        <span
          title={`Not up at the pull, drunk during it (a situational elixir like Demonslaying is normally drunk this way) — ${describe(late, false)}`}
        >
          {late.length} mid-pull
        </span>
      )}
      {seconds.length > 0 && (
        <span title={`Already had it and drank another during the pull — ${describe(seconds, true)}`}>
          {seconds.length} second
        </span>
      )}
      {stacked.length > 0 && (
        <span
          title={stacked
            .map((p) => `${fightName(p.fightId)}: ${p.flask} + ${p.elixirs.join(" + ")}`)
            .join(" — ")}
        >
          {stacked.length} stacked
        </span>
      )}
    </span>
  );
}

/**
 * The elixir budget on one pull — everything that was up, not just the part
 * that graded it.
 *
 * **A flask does not mean the elixir slots were empty.** This used to return at
 * the flask and never look, which hid a real habit: on this guild's logs 33
 * pull-rows carry a flask *and* elixirs (one warrior runs Unstable Flask of the
 * Soldier with Major Agility and Gift of Arthas on top). Grading is right to
 * stop at the flask — the council's bar is met and `grade` says so — but the
 * cell is a record of what somebody drank, and a raider stacking three is
 * telling the officer something the pip cannot.
 *
 * So: flask first, then whatever else was up, with the extras marked as beyond
 * the bar rather than as part of it. Nothing here scores anything — `grade` and
 * `covered` are untouched, and an officer must not be able to read this as a
 * raider clearing a higher standard than the one the council set (invariant 5).
 */
function Coverage({
  pull,
  itemsByName,
}: {
  pull?: PreparednessPull;
  itemsByName: Record<string, ItemRef>;
}) {
  if (pull === undefined) return <Absent />;
  if (pull.flask === undefined && pull.elixirs.length === 0) return <Nothing>nothing</Nothing>;
  return (
    <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
      {pull.flask !== undefined && <Consumable name={pull.flask} itemsByName={itemsByName} />}
      {pull.elixirs.map((name) => (
        <Consumable key={name} name={name} itemsByName={itemsByName} />
      ))}
      {/* Stacked on top of a flask, which already met the bar on its own. Said
          quietly: it is a fact about what they drank, not a better grade. */}
      {pull.flask !== undefined && pull.elixirs.length > 0 && (
        <Badge
          variant="muted"
          title="Elixirs on top of a flask — the flask alone already covers the pull, so these are extra"
        >
          +{pull.elixirs.length} on top
        </Badge>
      )}
      {/* Half a set passes a lenient coverage bar, so say which half is empty
          rather than letting it read as complete. */}
      {pull.grade === "partial" && (
        <Badge variant="warning" title="One elixir slot filled, the other empty">
          no {pull.missingSlot === "battleElixir" ? "battle" : "guardian"}
        </Badge>
      )}
      {/* Drunk after the pull started, so the grade above does not count it —
          and must not. Named and timed, because "0:12" and "2:40" are different
          stories about the same raider. */}
      {pull.lateConsumables.map((l) => (
        <span
          key={l.name}
          className="text-[10px] text-muted-foreground/70"
          title={
            l.refill
              ? "Already had it at the pull and drank another during the fight"
              : "Not up when the pull started, so the grade above does not count it — which is normal for a situational elixir like Demonslaying"
          }
        >
          {l.name} at {atMinute(l.atMs)}
          {l.refill ? " (2nd)" : " (mid-pull)"}
        </span>
      ))}
    </span>
  );
}

/**
 * What each weapon carried, main hand first.
 *
 * **Both hands, because a raider buffs both** — a dual-wielding rogue runs a
 * different poison on each, and showing only the main hand reported half a job
 * as done. The hand is labelled whenever a pull carried two, and left off when
 * there is only one thing to say.
 *
 * Warcraft Logs records the enchantment id and never the item that applied it,
 * so the name comes from the enchant dictionary: an item name for the oils and
 * poisons, effect text for the stones ("Sharpened (+14 Crit Rating…)"). An id
 * nobody has resolved shows as an id rather than as a guess.
 *
 * A totem is not a consumable, and the column says so. Windfury Totem reaches a
 * party's weapons as a temporary enchant exactly like an oil does, so a raider
 * standing near a shaman otherwise reads as buffed without having bought
 * anything.
 */
function WeaponBuff({
  pull,
  enchantNames,
}: {
  pull?: PreparednessPull;
  enchantNames: Record<number, string>;
}) {
  if (pull === undefined) return <Absent />;
  const worn = pull.weaponEnchants;
  if (worn.length === 0) {
    // The stored flag and the gear snapshot can only disagree on a pull
    // imported before gear was captured — say "unknown" rather than "none".
    return pull.weaponBuff ? <Badge variant="secondary">applied</Badge> : <Nothing>none</Nothing>;
  }
  return (
    <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">

      {worn.map(({ hand, id }) => (

        <WeaponEnchant
          key={hand}
          id={id}
          name={enchantNames[id]}
          hand={worn.length > 1 ? hand : undefined}
        />
      ))}
    </span>
  );
}

/**
 * What went on the pet.
 *
 * Pet food outlives the pull it was applied in and there is no fight that owns
 * it, so the record is per player per report. Showing the night's total against
 * a single pull reads as a bug — "Kibler's Bits ×3" on one boss — so a scoped
 * view answers the question actually being asked instead: what landed inside
 * the scope, and how much came earlier in the night.
 *
 * A blank is "nothing logged for a pet", never "they forgot". Warcraft Logs
 * types hunter pets, shaman totems, druid treants and Shadowfiend identically,
 * so nothing here can tell who owns a pet, and a cross would be an accusation
 * the log does not support.
 */
function Pet({
  pet,
  scopeIds,
  all,
  itemsByName,
  estimate,
}: {
  pet?: PreparednessPet;
  scopeIds: Set<number>;
  all: boolean;
  itemsByName: Record<string, ItemRef>;
  /**
   * Item → what keeping it up for the whole night takes.
   *
   * Only drawn in the night view. Under a pull scope the cell answers "what
   * landed on this pull", and a night's estimate beside that would read as a
   * per-pull count — the same confusion the scoped view exists to avoid.
   */
  estimate?: Map<string, number>;
}) {
  if (pet === undefined) {
    return (
      <span className="text-muted-foreground/50" title="Nothing logged for a pet this night">
        –
      </span>
    );
  }

  if (all) {
    const entries = [...pet.food, ...pet.scrolls];
    // Counted and seen sit in one container as siblings, so they read as one
    // list of what the pet had rather than two groups that happen to be adjacent.

    return (
      <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
        {entries.map(([name, times]) => (
          <span
            key={name}
            className="inline-flex items-center gap-1"
            title="Applied across the whole night"
          >
            <Consumable name={name} itemsByName={itemsByName} />
            {times > 1 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">×{times}</span>
            )}
            <KeptUp times={times} maintained={estimate?.get(name)} />
          </span>
        ))}
        {pet.held.map((s) => (
          <SeenChip
            key={s.name}
            name={s.name}
            itemsByName={itemsByName}
            maintained={estimate?.get(s.name)}
          />
        ))}
      </span>
    );
  }

  /*
   * Scoped. "Between pulls" applications carry no fightId, so they can only be
   * placed on the clock — which is why the timing is stored at all. Everything
   * before the scope's first pull counts as earlier, feeding included.
   */
  const inScope = pet.applications.filter(
    (a) => a.fightId !== undefined && scopeIds.has(a.fightId),
  );
  const firstScoped = Math.min(...[...scopeIds]);
  const earlier = pet.applications.filter((a) => {
    if (a.fightId !== undefined) return a.fightId < firstScoped;
    // No pull: place it by the clock when we have one, else count it as earlier
    // (a row imported before the timing — a re-import fills it in).
    return true;
  }).length - inScope.filter((a) => a.fightId === undefined).length;

  if (inScope.length === 0) {
    // A sighting belongs to the night, not to a pull, so it survives the scope
    // — and an empty cell beside it would say "nothing logged" over evidence.
    if (earlier > 0 || pet.held.length > 0) {
      return (
        <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
          {earlier > 0 && (
            <span
              className="text-xs text-muted-foreground"
              title={`Nothing applied during this pull. ${earlier} earlier tonight: ${pet.applications.map((a) => a.name).join(", ")}`}
            >
              fed {earlier}× earlier
            </span>
          )}
          {pet.held.map((s) => (
            <SeenChip key={s.name} name={s.name} itemsByName={itemsByName} />
          ))}
        </span>
      );
    }
    return (
      <span className="text-muted-foreground/50" title="Nothing logged for a pet this night">
        –
      </span>
    );
  }

  const counts = new Map<string, number>();
  for (const a of inScope) counts.set(a.name, (counts.get(a.name) ?? 0) + 1);
  return (
    <span className="flex flex-col items-start gap-0.5 whitespace-nowrap">
      {[...counts].map(([name, times]) => (
        <span
          key={name}
          className="inline-flex items-center gap-1"
          title={
            earlier > 0
              ? `Applied during this pull. ${earlier} more earlier tonight.`
              : "Applied during this pull"
          }
        >
          <Consumable name={name} itemsByName={itemsByName} />
          {times > 1 && (
            <span className="text-[11px] tabular-nums text-muted-foreground">×{times}</span>
          )}
        </span>
      ))}
      {pet.held.map((s) => (
        <SeenChip key={s.name} name={s.name} itemsByName={itemsByName} />
      ))}
    </span>
  );
}

/**
 * One consumable the pet was seen carrying, with no cast behind it.
 *
 * Rendered without a count, and never as a failure. The aura stream can say the
 * pet held a scroll or was fed, but not how many were applied — a pet
 * re-entering play republishes its whole aura set at once — so a number here
 * would be invented. It is a fact about the night rather than about a pull, so
 * it reads the same under a pull scope as it does across the whole report.
 *
 * One chip rather than its own block: it sits as a sibling of the counted ones
 * inside the cell's stack, so seen and applied read as one list down the
 * column instead of two groups that happen to be adjacent.
 */
function SeenChip({
  name,
  itemsByName,
  maintained,
}: {
  name: string;
  itemsByName: Record<string, ItemRef>;
  maintained?: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title="Seen on the pet tonight. Pets are scrolled and fed between pulls, which a log does not record, so this says the pet was carrying it — not how many were bought."
    >
      <Consumable name={name} itemsByName={itemsByName} />
      <span className="text-[11px] text-muted-foreground/70">seen</span>
      <KeptUp times={0} maintained={maintained} />
    </span>
  );
}

/**
 * What keeping one consumable up all night would take, beside what was logged.
 *
 * Drawn only when it says something the count doesn't — a hunter who re-fed
 * more often than the window expects gets no arrow, because there is nothing to
 * estimate about a night they already told us about. The number comes from the
 * same view the gold tab prices (`analysis/pet-consumables.ts`), so the two
 * tabs cannot quote different figures for the same pet.
 */
function KeptUp({ times, maintained }: { times: number; maintained?: number }) {
  if (maintained === undefined || maintained <= times) return null;
  return (
    <span
      className="text-[11px] tabular-nums text-warn-ink"
      title={`Kept up all night that is ${maintained} — the log caught ${times === 0 ? "none of them" : `${times}`}. Nobody is charged for the difference.`}
    >
      → ×{maintained}
    </span>
  );
}

/**
 * The night's pet total, above a table that reads per pull.
 *
 * Here rather than only on the gold tab because it is a preparation fact before
 * it is a gold one: it says how much of what went on the pets this app can
 * actually see. Both halves are stated — what the cast stream caught, and what
 * keeping the same consumables up all night would take — because the gap
 * between them is the answer, and a single number would have to invent which
 * end is true. Scope-independent, like the column it describes.
 */
function PetTally({ view }: { view: PetSpendView }) {
  if (view.rows.length === 0) return null;
  const kinds = (["food", "scroll"] as const).map((group) => {
    const lines = view.rows.flatMap((r) => r.lines.filter((l) => l.group === group));
    return {
      group,
      logged: lines.reduce((s, l) => s + l.logged, 0),
      maintained: lines.reduce((s, l) => s + l.maintained, 0),
      unseen: lines.filter((l) => l.logged === 0).length,
    };
  });
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Pets tonight</span>
      {kinds.map(({ group, logged, maintained, unseen }) => (
        <span key={group} className="inline-flex items-center gap-1">
          {group === "food" ? "food" : "scrolls"}
          <span className="tabular-nums">×{logged}</span>
          {maintained > logged && (
            <span
              className="tabular-nums text-warn-ink"
              title={`Keeping them up for the whole ${view.spanHours.toFixed(1)}-hour night takes ${maintained}. The log caught ${logged}: pets are fed and scrolled between pulls, where nothing is recorded.`}
            >
              → ×{maintained}
            </span>
          )}
          {unseen > 0 && (
            <span
              className="text-warn-ink"
              title="Seen on a pet with no cast to explain it — real spend nothing has ever been charged for"
            >
              ({unseen} seen only)
            </span>
          )}
        </span>
      ))}
      <span className="text-muted-foreground/70">— priced on the Gold spent tab</span>
    </p>
  );
}

/**
 * Item level over the raider's usual gear, flagged when a weapon changed hands.
 *
 * Deliberately NOT the pull's own snapshot. Lurker is spawned by fishing, so
 * that pull catches raiders holding a level 30 rod — true about the pull and a
 * useless answer to "how geared are they", which is what this column is asked.
 * The most-worn item per slot answers that instead, and the marker says a swap
 * happened rather than hiding it.
 */
function ItemLevel({ row, enchantNames }: { row: PreparednessRow; enchantNames: Record<number, string> }) {
  if (row.ilvl === undefined) return <Absent />;
  return (
    <span className="inline-flex items-center gap-1">
      {row.ilvl.toFixed(1)}
      {row.weaponSwaps.length > 0 && (
        <SwapMark swaps={row.weaponSwaps} enchantNames={enchantNames} />
      )}
    </span>
  );
}

/** The detail sits in the tooltip, not in the row. */
function SwapMark({
  swaps,
  enchantNames,
}: {
  swaps: PreparednessSwap[];
  enchantNames: Record<number, string>;
}) {
  const detail = swaps
    .map((swap) => {
      const items = swap.items
        .map((i) => {
          // Per weapon, because that is the question a swap raises: an off-set
          // weapon that never gets an oil is invisible when the enchant is read
          // off whichever weapon happened to be in hand last.
          const temps = i.tempEnchantIds.map((id) => enchantNames[id] ?? `#${id}`).join(", ");
          return `${i.name ?? `#${i.itemId}`}${i.ilvl ? ` (${i.ilvl})` : ""} on ${i.pulls} pull${i.pulls === 1 ? "" : "s"} [${i.encounters.join(", ")}]${temps ? ` — ${temps}` : " — no temp enchant"}`;
        })
        .join(" | ");
      return `${swap.label} — ${items}`;
    })
    .join(" // ");
  return (
    <span
      title={`Weapon changed during the night, so item level reads the most-worn set. ${detail}`}
      className="cursor-help text-[10px] font-semibold text-info-ink"
    >
      ⇄
    </span>
  );
}

const HAND_LABEL = { main: "MH", off: "OH" } as const;

function WeaponEnchant({
  id,
  name,
  hand,
}: {
  id: number;
  name?: string;
  hand?: "main" | "off";
}) {
  const label = hand === undefined ? null : (
    <span className="text-[10px] font-semibold uppercase opacity-60">{HAND_LABEL[hand]}</span>
  );
  if (name === undefined) {
    return (
      <Badge variant="secondary" title={`Enchantment #${id} — not looked up yet. The import page names these.`}>
        {label}
        applied
        <span className="tabular-nums opacity-60">#{id}</span>
      </Badge>
    );
  }
  const totem = /windfury/i.test(name);
  return (
    <Badge
      variant={totem ? "muted" : "secondary"}
      title={
        totem
          ? `${name} — a shaman's totem reaching their party's weapons, not something this raider bought.`
          : name
      }
    >
      {label}
      {name}
    </Badge>
  );
}

/**
 * Enchanted slots, as of the last pull in scope, linking to the gear audit.
 *
 * The audit on the performance page already names which slots are bare and
 * grades what the rest carry; repeating that here would be a second place to
 * get it wrong. A raider the roster doesn't know has nowhere to link to.
 */
function Enchants({
  pulls,
  slots,
  name,
  slug,
  reportCode,
}: {
  pulls: PreparednessPull[];
  slots: number;
  name: string;
  slug?: string;
  reportCode: string;
}) {
  const latest = pulls[pulls.length - 1];
  if (latest === undefined || !latest.hasGear) return <Badge variant="muted">–</Badge>;

  const complete = latest.enchanted >= slots;
  // Freshly awarded items show up bare until they're enchanted, so a value that
  // moved during the night is usually good news — say it moved either way.
  const changed = new Set(pulls.filter((p) => p.hasGear).map((p) => p.enchanted)).size > 1;
  const title = complete
    ? "Every expected slot carries a permanent enchant"
    : `Missing: ${latest.missingEnchants.join(", ")}`;

  const badge = (
    <>
      <Badge
        variant={complete ? "success" : latest.enchanted >= slots - 2 ? "warning" : "destructive"}
        title={title}
      >
        {latest.enchanted}/{slots}
      </Badge>
      {changed && (
        <span className="ml-0.5 text-[10px] font-bold text-warn-ink" title="Changed during the night">
          △
        </span>
      )}
    </>
  );

  if (slug === undefined) {
    return <span title={`${name} isn't matched to a roster character`}>{badge}</span>;
  }
  return (
    <Link
      href={`/characters/${encodeURIComponent(slug)}/performance?report=${encodeURIComponent(reportCode)}#enchants`}
      className="hover:underline"
      title={`${title} — open the gear audit`}
    >
      {badge}
    </Link>
  );
}

function SortHeader({
  sort,
  column,
  onClick,
  align = "left",
  children,
}: {
  sort: Sort;
  column: Sort["by"];
  onClick: () => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const active = sort.by === column;
  const Arrow = sort.dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      title={column === "name" ? "Sort alphabetically" : "Sort by how prepared they were"}
      className={cn(
        "inline-flex cursor-pointer items-center gap-0.5 hover:text-foreground",
        align === "right" && "flex-row-reverse",
        active && "text-foreground",
      )}
    >
      {children}
      <Arrow className={cn("h-3 w-3", active ? "opacity-100" : "opacity-0")} />
    </button>
  );
}
