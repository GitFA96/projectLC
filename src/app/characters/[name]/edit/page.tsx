import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/data/repo";
import { buildLoggedGear, type LoggedGearReport } from "@/lib/analysis/logged-gear";
import { LOGGED_GEAR_RAIDS, loggedSlotOptions, reportsInSpec } from "@/lib/analysis/current-gear";
import { SLOT_META } from "@/lib/constants/wow";
import { sameSpec } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  CharacterForm,
  OffSpecCard,
  type MainOption,
  type SeenSpec,
} from "@/components/character-form";
import { GearSetManager, type GearSetRow } from "@/components/gear-set-manager";
import { CurrentGearEditor, type GearSlotRow } from "@/components/current-gear-editor";
import type { ItemRef } from "@/components/item-link";
import type { QuickSearchItem } from "@/lib/analysis/quick-search";
import type { CurrentGearOverride, GearSet, Item, SlotItem } from "@/lib/types";

import { pageView } from "@/lib/auth/view";
import { NoAccess } from "@/components/no-access";
import { compareText } from "@/lib/sort";

type Params = { name: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  return { title: `Edit ${decoded.charAt(0).toUpperCase() + decoded.slice(1)}` };
}

function toRow(set: GearSet): GearSetRow {
  return {
    id: set.id,
    name: set.name,
    kind: set.kind,
    phase: set.phase,
    importedAt: set.importedAt,
    slotCount: set.slots.length,
    source: set.source,
  };
}

export default async function CharacterEditPage({ params }: { params: Promise<Params> }) {
  const access = await pageView("roster.edit", { returnTo: "/roster" });
  if (!access.allowed) return <NoAccess reason={access.reason} />;

  const { name } = await params;
  const repo = await getRepo();
  const decoded = decodeURIComponent(name);
  const [bundle, performance, demand] = await Promise.all([
    repo.getCharacterBundle(decoded),
    repo.getCharacterPerformance(decoded),
    repo.listItemDemand(),
  ]);
  if (!bundle) notFound();

  // Candidate mains: every other guild character (a main is never a pug).
  const mains: MainOption[] = (await repo.listCharacters())
    .filter((s) => s.character.id !== bundle.character.id && s.character.status !== "pug")
    .map((s) => ({ id: s.character.id, name: s.character.name, wowClass: s.character.class }))
    .sort((a, b) => compareText(a.name, b.name));

  // Specs their logs actually show, most-played first — the evidence that an
  // off-spec exists at all. WCL only says tank/healer/dps, so a role is only
  // suggested where that's unambiguous; melee-vs-ranged is left to the officer.
  const pullsBySpec = new Map<string, { pulls: number; roles: Set<string> }>();
  for (const report of performance?.reports ?? []) {
    for (const row of report.rows) {
      if (!row.spec) continue;
      const entry = pullsBySpec.get(row.spec) ?? { pulls: 0, roles: new Set<string>() };
      entry.pulls++;
      entry.roles.add(row.role);
      pullsBySpec.set(row.spec, entry);
    }
  }
  const seenSpecs: SeenSpec[] = [...pullsBySpec]
    .sort((a, b) => b[1].pulls - a[1].pulls)
    .map(([spec, { pulls, roles }]) => ({
      spec,
      pulls,
      role:
        roles.size === 1 && roles.has("tank")
          ? ("Tank" as const)
          : roles.size === 1 && roles.has("healer")
            ? ("Healer" as const)
            : undefined,
      isMain: sameSpec(spec, bundle.character.spec),
    }));

  const sets: GearSetRow[] = [
    ...(bundle.importedCurrent ? [toRow(bundle.importedCurrent)] : []),
    ...bundle.wishlists.map((w) => toRow(w.set)),
  ];

  // Everything the slot editor needs: what's recorded now, what the import
  // said before any pinning, and what they were logged wearing lately.
  const itemsById = new Map((await repo.listItems()).map((i) => [i.id, i] as const));
  const toRef = (slot: SlotItem): ItemRef => {
    const cached: Item | undefined = itemsById.get(slot.itemId);
    return {
      itemId: slot.itemId,
      name: cached?.name ?? slot.itemName,
      quality: cached?.quality,
      icon: cached?.icon,
    };
  };
  const loggedReports: LoggedGearReport[] = (performance?.reports ?? []).map((r) => ({
    report: r.report,
    rows: r.rows,
  }));

  /**
   * One kit's rows. The off-spec kit is built the same way from a narrower
   * window — only the nights they actually played that spec — and with no
   * imported set behind it, because nobody exports the gear they wear on the
   * two fights a month the guild is short a tank.
   */
  function buildGearRows(opts: {
    set?: GearSet;
    imported?: GearSet;
    overrides: CurrentGearOverride[];
    /** Restrict the logged options to pulls in this spec. */
    inSpec?: string;
  }): GearSlotRow[] {
    const bySlot = new Map((opts.set?.slots ?? []).map((s) => [s.slot, s] as const));
    const importedBySlot = new Map((opts.imported?.slots ?? []).map((s) => [s.slot, s] as const));
    const pinnedSlots = new Set(opts.overrides.map((o) => o.item.slot));
    const loggedBySlot = loggedSlotOptions(
      buildLoggedGear(reportsInSpec(loggedReports, opts.inSpec), { limit: LOGGED_GEAR_RAIDS }),
    );
    return SLOT_META.map(({ id }) => {
      const current = bySlot.get(id);
      const imported = importedBySlot.get(id);
      return {
        slot: id,
        current: current ? toRef(current) : undefined,
        pinned: pinnedSlots.has(id),
        imported: imported ? toRef(imported) : undefined,
        logged: (loggedBySlot.get(id) ?? []).map((option) => {
          const cached = itemsById.get(option.itemId);
          return {
            ...option,
            name: cached?.name ?? option.name,
            icon: cached?.icon ?? option.icon,
            quality: cached?.quality ?? option.quality,
          };
        }),
      };
    });
  }

  const gearRows = buildGearRows({
    set: bundle.current,
    imported: bundle.importedCurrent,
    overrides: bundle.currentOverrides,
  });
  const { offSpec } = bundle.character;
  const offSpecGearRows = offSpec
    ? buildGearRows({
        set: bundle.offSpecCurrent,
        overrides: bundle.offSpecOverrides,
        inSpec: offSpec,
      })
    : undefined;

  // The searchable item database — the same index the nav's quick search uses,
  // so anything findable there is pinnable here.
  const searchItems: QuickSearchItem[] = demand.map((d) => ({
    itemId: d.itemId,
    name: d.name,
    quality: d.quality,
    icon: d.icon,
    slot: d.slot,
    wisherCount: d.wisherCount,
    openCount: d.openCount,
    awardCount: d.awardCount,
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Edit ${bundle.character.name}`}
        description="Character details, imported gear sets and what they currently have equipped."
      />
      {/* Who they are and what's been imported for them, then a kit per column. */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CharacterForm
          character={bundle.character}
          mains={mains}
          professionGap={bundle.summary.professionGap}
        />
        <div className="space-y-4">
          <GearSetManager sets={sets} characterName={bundle.character.name} />
          <OffSpecCard character={bundle.character} seenSpecs={seenSpecs} />
        </div>
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <CurrentGearEditor
          characterName={bundle.character.name}
          rows={gearRows}
          items={searchItems}
          pinnedCount={bundle.currentOverrides.length}
        />
        {offSpec && offSpecGearRows && (
          <CurrentGearEditor
            characterName={bundle.character.name}
            rows={offSpecGearRows}
            items={searchItems}
            pinnedCount={bundle.offSpecOverrides.length}
            spec="off"
            offSpec={offSpec}
          />
        )}
      </div>
    </div>
  );
}
