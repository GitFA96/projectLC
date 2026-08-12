/**
 * What a guild can grant.
 *
 * The **vocabulary is code**; who holds it is the guild's. A capability exists
 * because a line of code checks it, which is why a guild cannot invent one —
 * inventing it would grant nothing. Roles, their names and their grants are all
 * data (see docs/guild-and-player-profiles.md §4).
 *
 * Two rules this file exists to keep:
 *
 *   - **Deny by default.** Anything not granted is denied, and a capability
 *     added in a later release is denied to every role except the guild master.
 *     Shipping a feature can never quietly open data a guild had closed.
 *   - **Every capability gates something.** One that gates nothing is a lie
 *     told by the permissions UI, and a guild will make decisions on it.
 */

export type CapabilityGroup = "guild" | "roster" | "loot" | "logs" | "members";

export interface CapabilityMeta {
  /** Shown in the grant editor. */
  label: string;
  /** What it gates, in the officer's words — this is UI copy, not a comment. */
  gates: string;
  /** Reads can be handed out freely; writes are the ones worth arguing about. */
  kind: "read" | "write";
  group: CapabilityGroup;
  /**
   * Granted along with this one, transitively.
   *
   * Only where the alternative is incoherent — "may award loot but may not see
   * the ledger" is a state a checkbox UI will produce by accident, and it fails
   * as a blank page rather than as a denial. Edit implies view of the same
   * resource; awarding implies seeing who you are awarding to.
   *
   * Deliberately NOT transitive-by-convenience: `import.run` writes characters,
   * awards and reports but implies no view at all. A write that dragged every
   * matching read in behind it would be a back door with a friendly name.
   */
  implies?: readonly Capability[];
}

/**
 * Spelled out rather than derived from `CAPABILITIES` below, because `implies`
 * refers back to this type and `keyof typeof` would make the pair circular.
 * `Record<Capability, CapabilityMeta>` keeps the two in lockstep: a capability
 * added here and not below fails to compile, and so does the reverse.
 */
export type Capability =
  | "guild.view"
  | "guild.edit"
  | "policy.edit"
  | "roster.view"
  | "roster.edit"
  | "loot.view"
  | "loot.award"
  | "priority.view"
  | "priority.edit"
  | "logs.view"
  | "logs.edit"
  | "raid.plan"
  | "sim.edit"
  | "import.run"
  | "items.curate"
  | "comments.write"
  | "guides.edit"
  | "members.manage"
  | "roles.manage";

export const CAPABILITIES: Record<Capability, CapabilityMeta> = {
  "guild.view": {
    label: "See the guild",
    gates: "The guild profile beyond the public face — standing, contested items, policy.",
    kind: "read",
    group: "guild",
  },
  "guild.edit": {
    label: "Edit the guild",
    gates: "Name, realm, faction and the active phase.",
    kind: "write",
    group: "guild",
    implies: ["guild.view"],
  },
  "policy.edit": {
    label: "Set loot policy",
    gates: "The scoring weights and every other number the council can set.",
    kind: "write",
    group: "guild",
    implies: ["guild.view"],
  },
  "roster.view": {
    label: "See the roster",
    gates: "The roster and character profiles.",
    kind: "read",
    group: "roster",
  },
  "roster.edit": {
    label: "Edit the roster",
    gates: "Creating, editing and removing characters.",
    kind: "write",
    group: "roster",
    implies: ["roster.view"],
  },
  "loot.view": {
    label: "See the loot ledger",
    gates: "Who was awarded what, and when.",
    kind: "read",
    group: "loot",
  },
  "loot.award": {
    label: "Award loot",
    gates: "Recording awards and working the loot plan.",
    kind: "write",
    group: "loot",
    implies: ["loot.view", "roster.view"],
  },
  "priority.view": {
    label: "See the priority sheet",
    gates: "The council's spec priority sheet and per-item chains.",
    kind: "read",
    group: "loot",
  },
  "priority.edit": {
    label: "Edit the priority sheet",
    gates: "Pasting a phase's sheet and overriding one item's chain.",
    kind: "write",
    group: "loot",
    implies: ["priority.view"],
  },
  "logs.view": {
    label: "See raid logs",
    gates: "Raid reports, parses, preparation and deaths.",
    kind: "read",
    group: "logs",
  },
  "logs.edit": {
    label: "Adjust a raid night",
    gates:
      "Excusing pulls, setting consumable prices, correcting what a report counted.",
    kind: "write",
    group: "logs",
    implies: ["logs.view"],
  },
  "raid.plan": {
    label: "Plan raids",
    gates: "The raid planner, its boards and saved rosters.",
    kind: "write",
    group: "logs",
    implies: ["roster.view"],
  },
  "sim.edit": {
    label: "Set sim baselines",
    gates: "The saved simulation profile for a class and spec.",
    kind: "write",
    group: "logs",
    implies: ["logs.view"],
  },
  "import.run": {
    label: "Import data",
    gates: "Warcraft Logs reports, SixtyUpgrades wishlists and Gargul exports.",
    kind: "write",
    group: "logs",
  },
  "items.curate": {
    label: "Curate items",
    gates: "Which boss and phase an item belongs to, and pinning a sheet name to an id.",
    kind: "write",
    group: "loot",
  },
  "comments.write": {
    label: "Write council notes",
    gates: "Officer notes on a character or an item.",
    kind: "write",
    group: "roster",
    implies: ["roster.view"],
  },
  "guides.edit": {
    label: "Write class guides",
    gates: "The guild's own class and spec guides — a class lead's job, not the roster's.",
    kind: "write",
    group: "guild",
  },
  "members.manage": {
    label: "Manage members",
    gates: "Invites, assigning roles, and claiming characters for an account.",
    kind: "write",
    group: "members",
    implies: ["roster.view"],
  },
  "roles.manage": {
    label: "Manage roles",
    gates:
      "Creating roles and granting capabilities. Anyone with this can grant themselves anything.",
    kind: "write",
    group: "members",
    implies: ["members.manage"],
  },
};

export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as readonly Capability[];

/** The groups in the order a grant editor should show them, with a line of copy each. */
export const CAPABILITY_GROUPS: readonly { id: CapabilityGroup; label: string; blurb: string }[] = [
  { id: "guild", label: "Guild", blurb: "The guild's own identity, its loot policy and its guides." },
  { id: "roster", label: "Roster", blurb: "Characters, their profiles and the council's notes on them." },
  { id: "loot", label: "Loot", blurb: "The ledger, the priority sheet and the item cache." },
  { id: "logs", label: "Raids", blurb: "Warcraft Logs, raid planning, sims and imports." },
  { id: "members", label: "People", blurb: "Who is in the guild and what they may do. Handle with care." },
];

/**
 * Capabilities that may never sit in the **baseline** role.
 *
 * The line is drawn at exactly one thing: **a capability that hands out
 * capabilities cannot be a floor.** Put `roles.manage` under every member and
 * any of them grants themselves everything — the permission system still
 * renders, still has roles, and means nothing. `members.manage` is the same
 * shape one step removed: invite anybody, claim any character.
 *
 * That is a contradiction, not a policy question, which is why the code refuses
 * it rather than warning about it.
 *
 * **Everything else is the guild's to decide**, including choices this app
 * would not make — a guild that wants every member able to record an award is
 * answering a question about how it runs, and answering it in code here would
 * be the same overreach as shipping loot weights nobody can edit (invariant 5).
 * The editor states the consequence and gets out of the way.
 */
export const NEVER_BASELINE: readonly Capability[] = ["roles.manage", "members.manage"];

/**
 * Which of these grants the baseline may not hold — checked against the
 * **expanded** set, because `roles.manage` reaches `members.manage` through
 * `implies` and a check on the raw list would miss it.
 */
export function baselineViolations(granted: Iterable<string>): Capability[] {
  const effective = expandCapabilities(sanitizeCapabilities(granted));
  return NEVER_BASELINE.filter((c) => effective.has(c));
}

/**
 * `roles.manage` hands out capabilities, so holding it is holding all of them
 * one click away. The grant editor says so out loud rather than pretending it
 * is an ordinary permission — that is how a guild master ends up giving away
 * "just the role editor" and being surprised later.
 */
export const GUILD_MASTER_EQUIVALENT: readonly Capability[] = ["roles.manage"];

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && Object.hasOwn(CAPABILITIES, value);
}

/**
 * Drop anything the code no longer knows about.
 *
 * Grants are stored rows, and a capability renamed or retired in a release
 * leaves strings behind. Same house rule as every other getter: sanitize on
 * read so a stale row can't crash a page — and an unknown grant is denied, not
 * guessed at.
 */
export function sanitizeCapabilities(values: Iterable<string>): Capability[] {
  const out = new Set<Capability>();
  for (const value of values) if (isCapability(value)) out.add(value);
  return [...out];
}

/**
 * The effective set: everything granted, plus everything those grants imply.
 *
 * Run once when a viewer is built, so `can()` stays a set lookup rather than a
 * graph walk on every check. Fixpoint rather than one pass, because implications
 * chain (`roles.manage` → `members.manage` → `roster.view`).
 */
export function expandCapabilities(granted: Iterable<Capability>): Set<Capability> {
  const effective = new Set<Capability>(granted);
  let growing = true;
  while (growing) {
    growing = false;
    for (const capability of [...effective]) {
      for (const implied of CAPABILITIES[capability].implies ?? []) {
        if (!effective.has(implied)) {
          effective.add(implied);
          growing = true;
        }
      }
    }
  }
  return effective;
}
