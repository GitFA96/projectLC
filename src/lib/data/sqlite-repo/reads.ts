import {
  getRefusedItemNames,
  getAllConsumableAdjustments,
  getAllExcludedFights,
  getDb,
  getEnchantNames,
  getReportConsumableAdjustments,
  getItemPriorityRules,
  getSheetItemIds,
  getPrioritySheets,
  getGuides,
  getGuildPolicy,
  getGuildRoster,
  getRaidBoard,
  getReportConsumablePrices,
  getReportPayback,
  getTemplateBoard,
  listGuildRosters,
  getSimProfile,
  listSimProfiles,
  listStrandedSimSettings,
  getAbilities,
  getReportExcludedFights,
  membershipLastSeenByGuild,
  loadStore,
} from "@/lib/data/db";
import { createRepoFromStore } from "@/lib/data/store";
import type { PolicyOverrides } from "@/lib/analysis/policy";
import { buildPolicyPreview } from "@/lib/analysis/policy-preview";
import type { Repo } from "@/lib/data/repo";
import { compareText } from "@/lib/sort";
import { asGuides, readModel } from "./model";

/**
 * Every read on `Repo`, delegated to the cached model.
 *
 * The indirection is the point: each method calls `readModel()` when it is
 * called, so a repo handle taken before a write still answers with what the
 * write did.
 *
 * The handful that do not go through the model say why in place. Two shapes
 * recur — a value that lives in the `meta` table rather than in the derived
 * model, and a question about *now* (last-seen, whether an invitation has
 * lapsed) which a model keyed on `data_version` would answer with a stale
 * clock.
 */

// Delegate reads to the (possibly rebuilt) derived model on every call.
export const readMethods: Repo = {
  getGuild: () => readModel().repo.getGuild(),
  listCharacters: () => readModel().repo.listCharacters(),
  getCharacterBundle: (slug) => readModel().repo.getCharacterBundle(slug),
  listRaidSessions: () => readModel().repo.listRaidSessions(),
  listLootAwards: () => readModel().repo.listLootAwards(),
  getItem: (id) => readModel().repo.getItem(id),
  listItems: () => readModel().repo.listItems(),
  getItemContention: (itemId) => readModel().repo.getItemContention(itemId),
  listItemDemand: () => readModel().repo.listItemDemand(),
  listFeedback: () => readModel().repo.listFeedback(),
  /*
   * Rebuilt per call rather than served from the cached model.
   *
   * Two things here are outside the read model and would otherwise be stale:
   * `last_seen_at` (a login must not bump `data_version`) and the clock that
   * decides whether an invitation has lapsed. Both are cheap; the view is one
   * officer screen, not a hot path.
   */
  getPublicProfile: (visibility) => readModel().repo.getPublicProfile(visibility),
  listGuildAudit: () => readModel().repo.listGuildAudit(),
  getMembersView: async (now) => {
    const model = readModel();
    return createRepoFromStore(model.store, {
      membershipLastSeen: membershipLastSeenByGuild(getDb(), model.store.guild.id),
    }).getMembersView(now);
  },
  // Same treatment, and for the same two reasons: last-seen is outside the
  // read model, and "how long have they been quiet" is a question about now.
  getSuccessionState: async (now) => {
    const model = readModel();
    return createRepoFromStore(model.store, {
      membershipLastSeen: membershipLastSeenByGuild(getDb(), model.store.guild.id),
    }).getSuccessionState(now);
  },
  getDashboard: () => readModel().repo.getDashboard(),
  listWclReports: () => readModel().repo.listWclReports(),
  getCharacterPerformance: (slug) => readModel().repo.getCharacterPerformance(slug),
  getRaidReport: (code) => readModel().repo.getRaidReport(code),
  getComparison: (slugs, reportFilter) => readModel().repo.getComparison(slugs, reportFilter),
  listUntrackedLogPlayers: () => readModel().repo.listUntrackedLogPlayers(),
  // Prices live in the meta table, not the derived model — read them directly.
  getReportConsumablePrices: async (code) => getReportConsumablePrices(getDb(), code),
  getReportPayback: async (code) => getReportPayback(getDb(), code),
  getRaidBoard: async (code) => getRaidBoard(getDb(), code),
  getTemplateBoard: async () => getTemplateBoard(getDb()),
  listGuildRosters: async () => listGuildRosters(getDb()),
  getGuildRoster: async (id) => getGuildRoster(getDb(), id),
  getReportExcludedFights: async (code) => getReportExcludedFights(getDb(), code),
  /*
   * The spec index is counted off the pull rows in the read model; whether a
   * setup is saved for a spec lives in the meta table. Neither knows about the
   * other, so the two are joined here — and a spec with a saved setup but no
   * logged kills still has to appear, or a link pasted for a spec nobody has
   * raided yet would vanish without explanation.
   */
  listSimSpecs: async () => {
    const specs = await readModel().repo.listSimSpecs();
    const saved = listSimProfiles(getDb());
    const byKey = new Map(specs.map((s) => [`${s.wowClass}|${s.spec}`, s]));
    for (const p of saved) {
      const hit = byKey.get(`${p.wowClass}|${p.spec}`);
      if (hit) hit.hasProfile = true;
      else
        byKey.set(`${p.wowClass}|${p.spec}`, {
          wowClass: p.wowClass,
          spec: p.spec,
          hasProfile: true,
          kills: 0,
          raiders: [],
        });
    }
    return [...byKey.values()].sort(
      (a, b) => compareText(a.wowClass, b.wowClass) || compareText(a.spec, b.spec),
    );
  },
  getSimSpec: async (wowClass, spec) => {
    const db = getDb();
    const profile = getSimProfile(db, wowClass, spec);
    const detail = await readModel().repo.getSimSpec(wowClass, spec);
    // A saved setup keeps its page reachable even before anyone raids the spec.
    const base = detail ?? {
      wowClass,
      spec,
      pulls: [],
      fingerprints: [],
      stranded: [],
    };
    if (!detail && profile === undefined) return null;
    return {
      ...base,
      profile,
      /*
       * Setups from before spec profiles that no migration could place, shown
       * on every spec their build has ever been called so the officer can
       * adopt one where it belongs.
       *
       * One that IS already this profile drops out — the common case is the
       * setup the migration promoted, and offering to adopt what is already
       * saved reads as an unfinished step that can never be finished.
       */
      stranded: listStrandedSimSettings(db).filter(
        (s) =>
          s.wowClass === wowClass &&
          s.json !== profile &&
          (s.specs.length === 0 || s.specs.includes(spec)),
      ),
    };
  },
  listPullRows: (code, fightId) => readModel().repo.listPullRows(code, fightId),
  listAbilities: async () => getAbilities(getDb()),
  listEncounterNames: () => readModel().repo.listEncounterNames(),
  listUnmatchedSheetNames: () => readModel().repo.listUnmatchedSheetNames(),
  listUnmatchedConsumableNames: () => readModel().repo.listUnmatchedConsumableNames(),
  listRefusedItemNames: () => readModel().repo.listRefusedItemNames(),
  listConsumableItems: () => readModel().repo.listConsumableItems(),
  listBossComments: (zone: string) => readModel().repo.listBossComments(zone),
  listGuides: () => readModel().repo.listGuides(),
  getDropTable: (zone: string) => readModel().repo.getDropTable(zone),
  listFoundationalDrops: (zone?: string) => readModel().repo.listFoundationalDrops(zone),
  getFoundationalDropTable: (zone: string) => readModel().repo.getFoundationalDropTable(zone),
  listGuildDropOverrides: (zone?: string) => readModel().repo.listGuildDropOverrides(zone),
  listDuplicateDrops: () => readModel().repo.listDuplicateDrops(),
  listKnownDropSources: () => readModel().repo.listKnownDropSources(),
  listSheetDropSources: () => readModel().repo.listSheetDropSources(),
  getReportConsumableAdjustments: async (code) => getReportConsumableAdjustments(getDb(), code),
  listConsumableAdjustments: async () => getAllConsumableAdjustments(getDb()),
  listUnresolvedItemIds: () => readModel().repo.listUnresolvedItemIds(),
  listTokenBackfill: () => readModel().repo.listTokenBackfill(),
  getEnchantReference: () => readModel().repo.getEnchantReference(),
  listUnnamedEnchantIds: () => readModel().repo.listUnnamedEnchantIds(),
  getLootPriorityWeights: () => readModel().repo.getLootPriorityWeights(),
  getItemPriorityRule: (itemId, ...names) => readModel().repo.getItemPriorityRule(itemId, ...names),
  getPrioritySheet: (phase) => readModel().repo.getPrioritySheet(phase),
  getGuildPolicy: () => readModel().repo.getGuildPolicy(),
  getLootPlan: (zone: string) => readModel().repo.getLootPlan(zone),
  getRosterStanding: () => readModel().repo.getRosterStanding(),
  getDevelopment: (characterId: string) => readModel().repo.getDevelopment(characterId),
  listGearSets: () => readModel().repo.listGearSets(),
  listItemComments: (itemId: number) => readModel().repo.listItemComments(itemId),
  countItemComments: () => readModel().repo.countItemComments(),
  listWishlistAlternatives: () => readModel().repo.listWishlistAlternatives(),
  measureRoster: () => readModel().repo.measureRoster(),

  /**
   * Measure the roster twice: once as it stands, once under the proposed
   * policy. The second model is built and thrown away — nothing is stored,
   * which is the whole point of a preview.
   *
   * A full rebuild per preview is deliberate. It is the same code path the
   * real read model uses, so the preview cannot drift from what saving would
   * actually do — and at guild scale the rebuild is cheap.
   */
  async previewGuildPolicy(overrides: PolicyOverrides) {
    const db = getDb();
    const current = getGuildPolicy(db) as PolicyOverrides;
    const merged: PolicyOverrides = { ...current };
    for (const [key, value] of Object.entries(overrides) as [keyof PolicyOverrides, object][]) {
      merged[key] = { ...(current[key] as object), ...value } as never;
    }

    const before = await readModel().repo.measureRoster();
    const proposed = createRepoFromStore(loadStore(db), {
      excludedFightsByCode: getAllExcludedFights(db),
      policy: merged,
      itemPriorityRules: getItemPriorityRules(db),
      prioritySheetsByPhase: getPrioritySheets(db),
      sheetItemIds: getSheetItemIds(db),
      guides: asGuides(getGuides(db)),
      enchantNames: getEnchantNames(db),
      refusedItemNames: getRefusedItemNames(db),
      consumableAdjustmentsByCode: getAllConsumableAdjustments(db),
    });
    const after = await proposed.measureRoster();
    const afterByName = new Map(after.map((r) => [r.name, r]));

    return buildPolicyPreview(
      before.map((row) => ({
        ...row,
        preparedAfter: afterByName.get(row.name)?.preparedAfter,
        attendanceAfter: afterByName.get(row.name)?.attendanceAfter,
      })),
    );
  },
};
