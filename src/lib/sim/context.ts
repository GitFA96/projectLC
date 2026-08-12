import { potionsUsed } from "@/lib/analysis/potions";
import { hasFood } from "@/lib/analysis/preparation";
import type { WclPlayerFight } from "@/lib/types";
import type { IndividualSimSettings } from "@/lib/sim/request";
import type { BloodFrenzyEvidence } from "@/lib/sim/inference";

import { compareText } from "@/lib/sort";

/**
 * Auditing a simulation's assumptions against the pull it's being compared to.
 *
 * A DPS gap only means something if the two runs happened under the same
 * conditions. The sim assumes a buff set, a debuff set, a consumable kit and a
 * fight length; the pull had whatever the raid actually managed. Every
 * difference moves the gap without the player having done anything differently
 * — a sim that assumes drums nobody brought is not measuring his rotation.
 *
 * So this runs BEFORE anyone reads a DPS number, and reports each difference
 * with the direction it pushes. It never blocks a comparison and never scores
 * one: it hands the officer the outliers and lets them decide how much of the
 * gap is real.
 *
 * Pure. The caller supplies the pull and the raid-wide debuff picture.
 */

export type ContextCategory = "encounter" | "consumable" | "raid buff" | "debuff";

export type ContextVerdict =
  /** The sim's assumption held on this pull. */
  | "match"
  /** The sim assumed it; the pull didn't have it — flatters the sim. */
  | "sim-only"
  /** The pull had it; the sim didn't assume it — flatters the pull. */
  | "log-only"
  /** Both present but materially different (a partial uptime, a shorter fight). */
  | "differs"
  /** Not tracked well enough to say — never counted as agreement. */
  | "unknown";

export interface ContextRow {
  category: ContextCategory;
  name: string;
  /** What the simulation assumed. */
  sim: string;
  /** What the log actually shows. */
  logged: string;
  verdict: ContextVerdict;
  /** Which side the difference flatters, for reading the gap honestly. */
  favours: "sim" | "log" | "neither";
  /**
   * Reasoned from other evidence rather than observed, because the combat log
   * doesn't carry this one. Marked so a reader can weigh it — never silently
   * mixed in with what was measured. See sim/inference.
   */
  inferred?: boolean;
}

export interface SimContextAudit {
  rows: ContextRow[];
  /** Differences that inflate the sim's number relative to the pull. */
  favoursSim: number;
  /** Differences that inflate the pull's number relative to the sim. */
  favoursLog: number;
  unknown: number;
  matched: number;
}

/**
 * Uptime at or above this counts as "the raid had it", matching what a sim
 * means by a debuff being enabled — sims model these as permanently applied.
 * Below the absent threshold it's noise (a warrior's own 8% Sunder is not
 * "Sunder Armor was up"). Between the two it's a real partial, and the sim
 * is over-assuming.
 */
const PRESENT_PCT = 80;
const ABSENT_PCT = 20;

/**
 * Armor reduction is ONE debuff slot, not two.
 *
 * Expose Armor and Sunder Armor overwrite each other — a rogue's Expose
 * displaces the warriors' stack, and they can't keep sundering on top of it.
 * Auditing them separately produces a guaranteed false finding: with Expose at
 * 90%, the leftover 8% Sunder reads as "the raid failed to keep Sunder up"
 * when in fact keeping it up was impossible and undesirable.
 *
 * So they share a row, satisfied by whichever is actually running.
 */
const ARMOR_SLOT_KEYS = ["exposeArmor", "sunderArmor"];
const ARMOR_SLOT_TRACKS = ["Expose Armor", "Sunder Armor"];

/**
 * Debuffs a wowsims TBC config can switch on, and the aura names logs use.
 *
 * Spell-damage debuffs (Misery, Curse of the Elements) sit here on the same
 * footing as everything else. They do nothing for a warrior's own number, but
 * the raid's damage depends on them and the officer reading this panel is
 * reading it about a raid night — singling them out as second-class rows only
 * made the table harder to scan.
 */
const DEBUFF_KEYS: { key: string; label: string; tracks: string[] }[] = [
  { key: "misery", label: "Misery", tracks: ["Misery"] },
  { key: "faerieFire", label: "Faerie Fire", tracks: ["Faerie Fire", "Faerie Fire (Feral)"] },
  { key: "curseOfRecklessness", label: "Curse of Recklessness", tracks: ["Curse of Recklessness"] },
  { key: "curseOfElements", label: "Curse of the Elements", tracks: ["Curse of the Elements"] },
  { key: "huntersMark", label: "Hunter's Mark", tracks: ["Hunter's Mark"] },
  {
    key: "improvedSealOfTheCrusader",
    label: "Judgement of the Crusader",
    tracks: ["Judgement of the Crusader"],
  },
  { key: "judgementOfWisdom", label: "Judgement of Wisdom", tracks: ["Judgement of Wisdom"] },
  { key: "mangle", label: "Mangle", tracks: ["Mangle (Cat)", "Mangle (Bear)"] },
  { key: "bloodFrenzy", label: "Blood Frenzy", tracks: ["Blood Frenzy"] },
  { key: "giftOfArthas", label: "Gift of Arthas", tracks: ["Gift of Arthas"] },
];

/**
 * The rest of the sim's buff config: raid-wide, party-wide and personal.
 *
 * Nearly all of it is measurable, which was not obvious: the stored upkeep
 * tracks cover auras a raider is RESPONSIBLE for, so blessings and drums landing
 * ON someone are nowhere in them, and a first pass reported a dozen of these as
 * "not tracked by this app". Warcraft Logs' buff table has every aura the player
 * carried, with uptime — see fetchPlayerAuras. Only the totem party buffs
 * genuinely never reach the combat log.
 *
 * Both the sim keys and the aura names are verified against real data, not
 * memory: the keys off a decoded wowsims export, the names off a real buff table.
 */
const BUFF_KEYS: {
  key: string;
  label: string;
  /** Where in the settings it lives. */
  from: "raidBuffs" | "partyBuffs" | "playerBuffs";
  /**
   * Aura names as the log spells them, including the greater/lesser variants.
   * A hit here is a measurement of THIS raider — not of the raid.
   */
  auras?: string[];
  /**
   * Totem drops that prove the raid put one down, for the buffs TBC never
   * writes to the combat log. Weaker evidence: it says somebody dropped it,
   * not that this player stood in it.
   */
  castNames?: string[];
}[] = [
  { key: "bloodlust", label: "Bloodlust / Heroism", from: "raidBuffs", auras: ["Bloodlust", "Heroism"] },
  {
    key: "powerWordFortitude",
    label: "Power Word: Fortitude",
    from: "raidBuffs",
    auras: ["Power Word: Fortitude", "Prayer of Fortitude"],
  },
  {
    key: "giftOfTheWild",
    label: "Gift of the Wild",
    from: "raidBuffs",
    auras: ["Gift of the Wild", "Mark of the Wild"],
  },
  // Totem party buffs never reach the combat log — see SHAMAN_TOTEM_CASTS —
  // so these are answered from the drop, not from the buff.
  { key: "strengthOfEarthTotem", label: "Strength of Earth Totem", from: "partyBuffs", castNames: ["Strength of Earth Totem"] },
  { key: "graceOfAirTotem", label: "Grace of Air Totem", from: "partyBuffs", castNames: ["Grace of Air Totem"] },
  { key: "windfuryTotem", label: "Windfury Totem", from: "partyBuffs", castNames: ["Windfury Totem"] },
  { key: "leaderOfThePack", label: "Leader of the Pack", from: "partyBuffs", auras: ["Leader of the Pack"] },
  {
    key: "ferociousInspiration",
    label: "Ferocious Inspiration",
    from: "partyBuffs",
    auras: ["Ferocious Inspiration"],
  },
  {
    key: "blessingOfKings",
    label: "Blessing of Kings",
    from: "playerBuffs",
    auras: ["Blessing of Kings", "Greater Blessing of Kings"],
  },
  {
    key: "blessingOfMight",
    label: "Blessing of Might",
    from: "playerBuffs",
    auras: ["Blessing of Might", "Greater Blessing of Might"],
  },
  { key: "unleashedRage", label: "Unleashed Rage", from: "playerBuffs", auras: ["Unleashed Rage"] },
];

/**
 * Consumables the sim configures by item id, paired with what the pull records.
 * Compared by presence, not identity: the log names the flask, the sim gives an
 * item id, and asking "did he have a flask at all" is the question that matters
 * for reading a DPS gap.
 */
const CONSUMABLE_KEYS: { key: string; label: string; had: (p: WclPlayerFight) => boolean; loggedLabel: (p: WclPlayerFight) => string }[] = [
  { key: "flaskId", label: "Flask", had: (p) => Boolean(p.flask) || p.elixirs.length > 0, loggedLabel: (p) => p.flask ?? (p.elixirs.length ? p.elixirs.join(", ") : "none") },
  { key: "foodId", label: "Food buff", had: (p) => hasFood(p), loggedLabel: (p) => (hasFood(p) ? "Well Fed" : "none") },
  { key: "ohImbueId", label: "Weapon buff", had: (p) => p.weaponBuff, loggedLabel: (p) => (p.weaponBuff ? "applied" : "none") },
];

/**
 * Potions are a rate, not a flag.
 *
 * TBC's potion cooldown is two minutes and it starts before the pull, so a
 * raider chains them with their cooldowns rather than taking one "pre-pot".
 * Auditing a prepot boolean asked the wrong question: it marked a raider down
 * for not doing something that isn't a distinct action, while missing the thing
 * that matters — whether they kept using potions through a long fight.
 *
 * A fight only affords so many, so this compares counts and gives credit for a
 * pre-pull one, which the log records separately from in-combat casts.
 */
function potionRow(pull: WclPlayerFight, simHasPotion: boolean): ContextRow | undefined {
  const used = potionsUsed(pull);
  // Two-minute cooldown, and one before the pull is free.
  const afforded = 1 + Math.floor(pull.durationMs / 120_000);
  if (!simHasPotion && used === 0) return undefined;

  const logged =
    used === 0
      ? `none (room for ${afforded})`
      : `${used} of ${afforded} the fight allowed${pull.prepot ? ", incl. pre-pull" : ""}`;

  if (!simHasPotion) return row("consumable", "Potions", "no", logged, "log-only");
  if (used === 0) return row("consumable", "Potions", `yes — ${afforded}`, logged, "sim-only");
  return row("consumable", "Potions", `yes — ${afforded}`, logged, used < afforded ? "differs" : "match");
}

/**
 * Blood Frenzy, which no TBC combat log carries.
 *
 * Every other row in this audit compares two observations. This one compares an
 * observation to a deduction, so it is labelled as such and shows its working —
 * who the Arms warrior was, what build they logged, and which bleed the number
 * came from. An officer who knows that warrior didn't take the talent can
 * discount it; nobody is told the raid "had" something we never saw.
 */
function bloodFrenzyRow(simLabel: string, evidence: BloodFrenzyEvidence | undefined): ContextRow {
  if (!evidence) {
    return row("debuff", "Blood Frenzy", simLabel, "never written to the combat log", "unknown");
  }
  if (evidence.kind === "no-arms-warrior") {
    // A real finding, and a solid one: with no Arms warrior on the pull there
    // is nobody who could have brought it, whatever the talents say.
    return row("debuff", "Blood Frenzy", simLabel, "no — no Arms warrior in the raid", "sim-only");
  }
  if (evidence.kind === "no-bleed") {
    return row(
      "debuff",
      "Blood Frenzy",
      simLabel,
      `no — ${evidence.by} kept no Rend or Deep Wounds on the boss`,
      "sim-only",
      { inferred: true },
    );
  }
  const build = evidence.build ? ` ${evidence.build}` : "";
  const logged = `~${evidence.pct}% — ${evidence.by} (Arms${build}) held ${evidence.via} that long`;
  return row(
    "debuff",
    "Blood Frenzy",
    simLabel,
    logged,
    evidence.pct >= PRESENT_PCT ? "match" : evidence.pct > ABSENT_PCT ? "differs" : "sim-only",
    { inferred: true },
  );
}

/**
 * Jewelcrafting party necks — one wearer buffs their whole group.
 *
 * Party-scoped rather than raid-scoped, which is what makes them worth
 * auditing: the guild can own all three and still leave this player's group
 * uncovered, and no gear check would show it. Sims switch them on by default.
 */
const PARTY_NECKS: { key: string; name: string }[] = [
  { key: "braidedEterniumChain", name: "Braided Eternium Chain" },
  { key: "chainOfTheTwilightOwl", name: "Chain of the Twilight Owl" },
  { key: "eyeOfTheNight", name: "Eye of the Night" },
];

/**
 * How a wowsims setting reads on screen.
 *
 * "assumed" told the reader nothing — it hid whether the sim wanted the
 * improved version, and it made a yes/no question look like a hedge. Show the
 * actual value.
 */
function simValue(value: unknown): string {
  if (typeof value === "string") {
    if (/Improved$/i.test(value)) return "yes (improved)";
    if (/Regular$/i.test(value)) return "yes";
    if (/Missing$/i.test(value)) return "no";
    return value;
  }
  if (typeof value === "number") return value > 0 ? String(value) : "no";
  return value ? "yes" : "no";
}

/** True when a wowsims tristate/boolean field is switched on. */
function enabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") return value !== "" && !/^TristateEffectMissing$/i.test(value);
  return false;
}

function row(
  category: ContextCategory,
  name: string,
  sim: string,
  logged: string,
  verdict: ContextVerdict,
  flags: { inferred?: boolean } = {},
): ContextRow {
  const favours: ContextRow["favours"] =
    verdict === "sim-only" || verdict === "differs" ? "sim" : verdict === "log-only" ? "log" : "neither";
  return {
    category,
    name,
    sim,
    logged,
    verdict,
    favours,
    ...(flags.inferred ? { inferred: true } : {}),
  };
}

/**
 * The best uptime each tracked aura reached on the boss, across everyone in the
 * pull. One player's row only knows what they kept up themselves; a raid debuff
 * is whatever the raid managed between them.
 */
export function bossDebuffUptime(pullRows: WclPlayerFight[]): Record<string, number> {
  const best: Record<string, number> = {};
  for (const r of pullRows) {
    for (const track of r.upkeep) {
      for (const target of track.targets ?? []) {
        if (!target.boss) continue;
        if ((best[track.name] ?? -1) < target.pct) best[track.name] = target.pct;
      }
    }
  }
  return best;
}

/**
 * Buffs this player actually RECEIVED during the pull, name → best uptime %.
 *
 * The mirror of bossDebuffUptime. A raid buff is recorded against whoever cast
 * it, with the recipients listed per target, so answering "did this raider have
 * it" means scanning every row's targets for their own name — their own row
 * only knows what they provided to others.
 */
export function playerBuffUptime(
  pullRows: WclPlayerFight[],
  actorName: string,
): Record<string, number> {
  const want = actorName.toLowerCase();
  const best: Record<string, number> = {};
  for (const r of pullRows) {
    for (const track of r.upkeep) {
      for (const target of track.targets ?? []) {
        if (!target.player || target.target.toLowerCase() !== want) continue;
        if ((best[track.name] ?? -1) < target.pct) best[track.name] = target.pct;
      }
    }
  }
  return best;
}

/**
 * What an aura's ABSENCE from a report is allowed to mean.
 *
 * Three silences look identical in the stored rows and mean opposite things:
 * the raid didn't have the buff, this report was fetched before we tracked it,
 * or we've never tracked it at all. Reporting all three as "not tracked" made
 * the panel useless on freshly refetched data; reporting all three as "no"
 * would invent findings. So the caller states what was collected and when.
 */
export type TrackCoverage = "collected" | "stale" | "untracked";

export function coverageOf(
  name: string,
  tracks: AuditInput["tracks"],
): TrackCoverage {
  if (!tracks) return "untracked";
  if (!tracks.collected.has(name)) return "untracked";
  return tracks.atImport?.has(name) ? "collected" : "stale";
}

/** How an absent-but-tracked aura reads, per coverage. */
function absentLogged(coverage: TrackCoverage, absent: string): { logged: string; verdict: ContextVerdict } {
  if (coverage === "collected") return { logged: absent, verdict: "sim-only" };
  if (coverage === "stale")
    return { logged: "tracked only since a later import — refetch this report", verdict: "unknown" };
  return { logged: "not tracked by this app", verdict: "unknown" };
}

export interface AuditInput {
  settings: IndividualSimSettings;
  /** The player's own row for the pull. */
  pull: WclPlayerFight;
  /** Best boss uptime per aura across the raid — see bossDebuffUptime. */
  bossDebuffs?: Record<string, number>;
  /** Buffs the player received — see playerBuffUptime. */
  playerBuffs?: Record<string, number>;
  /**
   * Which auras this app collects now, and which the report was imported with.
   * Omit and every absence reads as unverifiable — see TrackCoverage.
   */
  tracks?: { collected: Set<string>; atImport?: Set<string> };
  /**
   * Drums used by ANYONE on the pull. A party buff isn't answered by the
   * audited player's own row — he isn't the leatherworker.
   */
  raidDrums?: number;
  /**
   * Cooldown and totem-drop names cast by anyone on the pull, with how many
   * times. Same reasoning as the drums: Bloodlust comes from a shaman and a
   * Strength of Earth Totem from whoever dropped it, so the audited raider's
   * own row is the one place the answer isn't.
   */
  raidCasts?: Record<string, number>;
  /**
   * Every aura this raider actually carried, by name — see fetchPlayerAuras.
   * This is what turns a dozen "not tracked by this app" rows into measurements
   * of the raider the comparison is about.
   */
  playerAuras?: Record<string, { pct: number; uses: number }>;
  /** Blood Frenzy, reasoned out — the log never writes it. See sim/inference. */
  bloodFrenzy?: BloodFrenzyEvidence;
  /** Sim length in ms, when it was overridden from the pull. */
  simDurationMs?: number;
}

export function auditSimContext(input: AuditInput): SimContextAudit {
  const { settings, pull } = input;
  const bossDebuffs = input.bossDebuffs ?? {};
  const playerBuffs = input.playerBuffs ?? {};
  const rows: ContextRow[] = [];

  /* Encounter length — the denominator under every rate in the comparison. */
  const simMs = input.simDurationMs ?? (settings.encounter?.duration ?? 0) * 1000;
  if (simMs > 0) {
    const drift = Math.abs(simMs - pull.durationMs);
    rows.push(
      row(
        "encounter",
        "Fight length",
        `${Math.round(simMs / 1000)}s`,
        `${Math.round(pull.durationMs / 1000)}s`,
        // Under 5% apart the rates stay honest; beyond that the comparison is
        // measuring two different fights.
        drift / Math.max(1, pull.durationMs) < 0.05 ? "match" : "differs",
      ),
    );
  }

  /* Consumables the player either had or didn't. */
  const consumables = (settings.player?.consumables ?? {}) as Record<string, unknown>;
  for (const c of CONSUMABLE_KEYS) {
    const simHas = Boolean(consumables[c.key]);
    const logHas = c.had(pull);
    if (!simHas && !logHas) continue;
    rows.push(
      row(
        "consumable",
        c.label,
        simHas ? "yes" : "no",
        c.loggedLabel(pull),
        simHas === logHas ? "match" : simHas ? "sim-only" : "log-only",
      ),
    );
  }
  const potions = potionRow(pull, Boolean(consumables.potId));
  if (potions) rows.push(potions);

  /* Drums are a party buff in the sim and a cast in the log. */
  const partyBuffs = (settings.partyBuffs ?? {}) as Record<string, unknown>;
  const raidBuffs = (settings.raidBuffs ?? {}) as Record<string, unknown>;

  /*
   * Jewelcrafting party necks. Party-scoped, not raid-scoped: the guild can own
   * all three and still leave this player's group uncovered, which is exactly
   * the assumption a sim makes silently. Checked against the buffs the player
   * actually had, not against who owns the item.
   */
  for (const neck of PARTY_NECKS) {
    // Same rule as the debuffs: only what this sim models. Two of the three are
    // caster necks, and a warrior standing in a spell-crit aura gains nothing —
    // reporting it as coverage he "had" would pad the panel with rows that
    // cannot move his number either way.
    const simHas = enabled(partyBuffs[neck.key]);
    if (!simHas) continue;
    const pct = playerBuffs[neck.name];
    if (pct === undefined) {
      const { logged, verdict } = absentLogged(
        coverageOf(neck.name, input.tracks),
        "no — nobody in this player's party wore one",
      );
      rows.push(row("raid buff", neck.name, "yes", logged, verdict));
      continue;
    }
    const rounded = Math.round(pct);
    const logged = rounded <= ABSENT_PCT ? `no — ${rounded}%` : `yes — ${rounded}% on this player`;
    rows.push(
      row(
        "raid buff",
        neck.name,
        "yes",
        logged,
        pct >= PRESENT_PCT ? "match" : pct > ABSENT_PCT ? "differs" : "sim-only",
      ),
    );
  }
  /*
   * The rest of the buff config, answered from what this raider actually
   * carried. Only the totem party buffs fall back to "somebody dropped one",
   * because those are the ones TBC never writes to the combat log.
   */
  const simPlayerBuffs = (settings.player?.buffs ?? {}) as Record<string, unknown>;
  const raidCasts = input.raidCasts ?? {};
  const auras = input.playerAuras;
  for (const b of BUFF_KEYS) {
    const source =
      b.from === "raidBuffs" ? raidBuffs : b.from === "partyBuffs" ? partyBuffs : simPlayerBuffs;
    if (!enabled(source[b.key])) continue;
    const simLabel = simValue(source[b.key]);

    /* Measured on this raider — the strongest answer available. */
    if (b.auras && auras) {
      const best = b.auras
        .map((n) => ({ name: n, hit: auras[n] }))
        .filter((x) => x.hit !== undefined)
        .sort((x, y) => y.hit!.pct - x.hit!.pct)[0];
      if (!best) {
        rows.push(row("raid buff", b.label, simLabel, "no — this raider never had it", "sim-only"));
      } else {
        const pct = best.hit!.pct;
        rows.push(
          row(
            "raid buff",
            b.label,
            simLabel,
            `${pct}% of the pull — ${best.name}`,
            pct >= PRESENT_PCT ? "match" : pct > ABSENT_PCT ? "differs" : "sim-only",
          ),
        );
      }
      continue;
    }

    /* No aura in the log: fall back to whether the raid dropped one. */
    const drops = b.castNames?.reduce((sum, n) => sum + (raidCasts[n] ?? 0), 0);
    if (drops === undefined) {
      rows.push(row("raid buff", b.label, simLabel, "not tracked by this app", "unknown"));
    } else if (drops > 0) {
      rows.push(
        row(
          "raid buff",
          b.label,
          simLabel,
          `${drops} dropped in the raid — TBC never logs who stood in one`,
          "match",
          { inferred: true },
        ),
      );
    } else {
      rows.push(row("raid buff", b.label, simLabel, "no — none dropped in the raid", "sim-only"));
    }
  }

  /*
   * Drums are a party buff dropped by a leatherworker, so the audited raider is
   * almost never the one who used them — reading his own cast count said "none
   * in the raid" on pulls where four raiders drummed.
   *
   * The buff IS logged per recipient, which an earlier pass got wrong: the
   * probe that "proved" otherwise used single quotes in a WCL filter and so
   * matched nothing at all. So the answer isn't how many the raid used — it's
   * how much of the pull THIS raider spent under them, which is also the only
   * version that says anything about his DPS.
   */
  const simDrums = enabled(partyBuffs.drums);
  const drumsUsed = input.raidDrums ?? pull.drums;
  const drumAura = auras
    ? Object.entries(auras)
        .filter(([name]) => /^Drums of /i.test(name))
        .sort((x, y) => y[1].pct - x[1].pct)[0]
    : undefined;
  if (simDrums || drumsUsed > 0 || drumAura) {
    const simLabel = simDrums ? `yes — ${String(partyBuffs.drums).replace(/^Drums?Of/, "")}` : "no";
    const inRaid = drumsUsed > 0 ? `${drumsUsed} used in the raid` : "none used in the raid";
    if (drumAura) {
      const pct = drumAura[1].pct;
      rows.push(
        row(
          "raid buff",
          "Drums of Battle",
          simLabel,
          `${pct}% of the pull on this raider (${inRaid})`,
          pct >= PRESENT_PCT ? "match" : pct > ABSENT_PCT ? "differs" : "sim-only",
        ),
      );
    } else if (auras) {
      // We have his full aura list and no drum in it: he was out of range.
      rows.push(
        row(
          "raid buff",
          "Drums of Battle",
          simLabel,
          drumsUsed > 0 ? `no — ${inRaid}, none reached this raider` : "no — nobody in the raid used drums",
          simDrums ? "sim-only" : "log-only",
        ),
      );
    } else {
      rows.push(
        row("raid buff", "Drums of Battle", simLabel, inRaid, simDrums === drumsUsed > 0 ? "match" : simDrums ? "sim-only" : "log-only", {
          inferred: drumsUsed > 0,
        }),
      );
    }
  }

  /* Debuffs on the boss — the biggest single lever on a melee sim. */
  const debuffs = (settings.debuffs ?? {}) as Record<string, unknown>;

  /* Armor reduction first, as one slot — see ARMOR_SLOT_KEYS. */
  // Modelled-only, like every other debuff: a caster's sim doesn't tick armor
  // reduction, and telling a shadow priest the raid kept Expose Armor up would
  // be reporting something that cannot move their number.
  const armorSimHas = ARMOR_SLOT_KEYS.some((k) => enabled(debuffs[k]));
  if (armorSimHas) {
    const armorBest = ARMOR_SLOT_TRACKS.map((t) => ({ t, pct: bossDebuffs[t] ?? -1 })).sort(
      (a, b) => b.pct - a.pct,
    )[0];
    const simLabel = ARMOR_SLOT_KEYS.filter((k) => enabled(debuffs[k]))
      .map((k) => (k === "exposeArmor" ? "Expose Armor" : "Sunder Armor"))
      .join(" / ");
    if (armorBest.pct < 0) {
      // One slot, two auras: it only counts as tracked if BOTH were collected —
      // "no Sunder" is not a finding when Expose might have been the one up.
      const coverage = ARMOR_SLOT_TRACKS.map((t) => coverageOf(t, input.tracks));
      const worst: TrackCoverage = coverage.includes("untracked")
        ? "untracked"
        : coverage.includes("stale")
          ? "stale"
          : "collected";
      const { logged, verdict } = absentLogged(worst, "no — neither Sunder nor Expose was kept up");
      rows.push(row("debuff", "Armor reduction", simLabel, logged, verdict));
    } else {
      const logged = `yes — ${armorBest.t} ${Math.round(armorBest.pct)}%`;
      rows.push(
        row(
          "debuff",
          "Armor reduction",
          simLabel,
          logged,
          armorBest.pct >= PRESENT_PCT ? "match" : armorBest.pct > ABSENT_PCT ? "differs" : "sim-only",
        ),
      );
    }
  }

  for (const d of DEBUFF_KEYS) {
    const simHas = enabled(debuffs[d.key]);
    /*
     * Blood Frenzy is never in the combat log — not under any rank id, not in
     * any report's ability dictionary. Running it through the tracked/absent
     * rules below would report "nobody applied it" on every pull forever, which
     * is a manufactured finding: the raid may well have had it. It gets its own
     * answer, reasoned from the bleed that carries it.
     */
    if (simHas && d.key === "bloodFrenzy") {
      rows.push(bloodFrenzyRow(simValue(debuffs[d.key]), input.bloodFrenzy));
      continue;
    }
    /*
     * Only audit what this sim models.
     *
     * A wowsims config lists the debuffs that matter to the spec being
     * simulated — a Fury warrior's has no Curse of the Elements, because spell
     * damage does nothing for him. Reporting "the raid had CoE and the sim
     * didn't assume it" would imply his logged number was flattered by
     * something that never touched it.
     *
     * What we give up: a debuff that DOES affect him but was left unticked in
     * the config reads as agreement rather than as a config error. That's a
     * visible setting the officer owns, and the trade is worth it — a panel
     * with irrelevant rows in it stops being read at all. Raid-wide debuff
     * coverage is a real question, but it belongs to the raid page, where
     * uptime is already tracked for every track and every player.
     */
    if (!simHas) continue;
    const uptime = Math.max(...d.tracks.map((t) => bossDebuffs[t] ?? -1));

    const simLabel = simValue(debuffs[d.key]);
    if (uptime < 0) {
      /*
       * Nothing in the pull. Whether that's a finding depends entirely on
       * whether we asked WCL for this aura when the report was imported —
       * "absent" from a report that never collected it would invent a finding
       * out of a gap in our own tracking. Blood Frenzy is the live example:
       * genuinely absent from every report, because nobody specs it.
       */
      const { logged, verdict } = absentLogged(
        // Either rank/variant satisfies the row, so the best coverage wins.
        d.tracks.map((t) => coverageOf(t, input.tracks)).includes("collected")
          ? "collected"
          : d.tracks.map((t) => coverageOf(t, input.tracks)).includes("stale")
            ? "stale"
            : "untracked",
        "no — nobody in the raid applied it",
      );
      rows.push(row("debuff", d.label, simLabel, logged, verdict));
      continue;
    }
    const logHas = uptime >= PRESENT_PCT;
    const partial = uptime > ABSENT_PCT && uptime < PRESENT_PCT;
    const pct = Math.round(uptime);
    const logged = pct <= ABSENT_PCT ? `no — ${pct}% on boss` : `yes — ${pct}% on boss`;
    if (simHas && logHas) rows.push(row("debuff", d.label, simLabel, logged, "match"));
    else if (simHas && partial) rows.push(row("debuff", d.label, `${simLabel}, all fight`, logged, "differs"));
    else if (simHas) rows.push(row("debuff", d.label, simLabel, logged, "sim-only"));
    else if (logHas) rows.push(row("debuff", d.label, "no", logged, "log-only"));
  }

  const count = (v: ContextRow["favours"]) => rows.filter((r) => r.favours === v).length;
  /*
   * Alphabetical, so a reader can find a named assumption without scanning.
   * The earlier order led with the differences, which reads well once and badly
   * every time after — you come back to this table looking for one row.
   * Nothing is lost: the verdict badge still says which rows disagree.
   */
  return {
    rows: rows.sort((a, b) => compareText(a.name, b.name)),
    favoursSim: count("sim"),
    favoursLog: count("log"),
    unknown: rows.filter((r) => r.verdict === "unknown").length,
    matched: rows.filter((r) => r.verdict === "match").length,
  };
}

/** One line for the top of the panel — how much to trust the DPS gap. */
export function auditHeadline(audit: SimContextAudit): string {
  const parts: string[] = [];
  if (audit.favoursSim > 0) parts.push(`${audit.favoursSim} favouring the sim`);
  if (audit.favoursLog > 0) parts.push(`${audit.favoursLog} favouring the pull`);
  if (audit.unknown > 0) parts.push(`${audit.unknown} unverifiable`);
  if (parts.length === 0) return "The sim's assumptions match this pull — the gap is rotation and cooldowns.";
  return `${parts.join(", ")}. Read the DPS gap with these in mind.`;
}
