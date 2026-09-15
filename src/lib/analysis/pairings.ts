import { pairingOf } from "@/lib/wcl/pairings";
import type { WclPlayerFight } from "@/lib/types";
import { compareText } from "@/lib/sort";

/**
 * Who a boss linked together, cast by cast — and who was standing in it.
 *
 * Pure: rows in, view out.
 *
 * Mother Shahraz's Fatal Attraction is the mechanic this was built for, and the
 * officers' question is "who keeps getting picked". The log answers that one
 * exactly: the debuff names every raider it landed on. It also answers a
 * second, larger question nobody thought to ask — **more of the damage lands on
 * raiders who were never picked than on the ones who were** (1,039,671 against
 * 990,266 across the thirteen pulls probed), so a board built from the debuff
 * alone would show the smaller half of what the mechanic costs.
 *
 * ## Rebuilding a cast out of per-raider rows
 *
 * Nothing stores who was paired with whom. Each row records only what happened
 * to that raider, and a cast is reconstructed here by **clustering on `atMs`**
 * — see `PAIRING_CLUSTER_MS` for why that is safe by three orders of magnitude.
 * Storing a partner list on every row instead would have written the same fact
 * three times and let two rows disagree about it.
 *
 * It also reports what the mechanic killed that was never a raider. The AoE
 * kills thornlings, goblin land mines, flame turrets, snakes and hunter pets —
 * 60 of them across six probed reports — and that is the half of the cost paid
 * in gold rather than health. It is kept in its own fields throughout: a dead
 * thornling is not damage its owner took, and nothing here adds the two.
 *
 * ## What this does not do
 *
 * It does not score anybody, and there is no number here to tune. Being picked
 * is something a boss does to a raider, and how much damage a pairing should
 * have cost is a judgement about positioning that the log cannot make — so this
 * view counts and times and stays quiet, exactly like the interrupt board.
 * AGENTS.md invariant 5.
 *
 * It also does not claim a cast picks three. The boss rolls three targets over
 * the whole raid and a roll that lands on a tank is lost — 0 of 254 picks
 * across sixteen reports landed on one, and the pets and deployables alive at
 * the cast make no difference — so a cast is shown with as many names as the
 * log gave it and nothing is ever drawn as missing. See `wcl/pairings.ts`.
 */

/** A raider, with the roster deep-link when their name matched somebody. */
export interface PairingActor {
  name: string;
  slug?: string;
  className?: string;
}

/**
 * How far apart two rows may sit and still be the same cast.
 *
 * Measured across all thirteen Mother Shahraz pulls of five reports: the spread
 * inside one cast is **0–10ms**, and the closest two casts on one pull are
 * **21,054ms** apart. A second is twenty times the worst observed spread and a
 * twentieth of the tightest gap, so it cannot split a cast or merge two.
 *
 * Not a policy number: it encodes what the log does, not what the council
 * thinks, and no verdict moves when it changes (invariant 5).
 */
export const PAIRING_CLUSTER_MS = 1_000;

/** One raider's share of one cast. */
export interface PairingMember extends PairingActor {
  /** How long they held the debuff. Absent on a bystander, and on a pick the log left open. */
  heldMs?: number;
  /** Damage the mechanic dealt them inside that cast's window, absorbs included. */
  damage: number;
  /** Damage it dealt their pets and deployables. Never added to `damage`. */
  petDamage: number;
  /** How many of those it killed. */
  petsKilled: number;
}

/** A thing counted by name — a deployable the mechanic killed, and how many. */
export interface PairingCount {
  name: string;
  count: number;
}

/**
 * One cast of the mechanic: who it linked, and who it caught.
 *
 * `picked` and `caught` are disjoint by construction — a raider is in exactly
 * one of them per cast — and both are kept because they are different facts. A
 * name in `picked` is somebody the boss chose; a name in `caught` is somebody
 * who was standing where it went off.
 */
export interface PairingCast {
  /** ms from the pull start. */
  atMs: number;
  /** The mechanic as the log named it. */
  spell: string;
  /** The boss the curated list records applying it, when it names one. */
  boss?: string;
  /** The raiders it was cast on, by name. */
  picked: PairingMember[];
  /**
   * Raiders who took its damage without being picked, hardest hit first.
   *
   * Damage to a **raider**, so somebody whose only loss was a thornling is not
   * here — they are in `kitKilled` below. Calling a raider "caught in it" for a
   * dead land mine would read as a positioning mistake they did not make.
   */
  caught: PairingMember[];
  /** Damage on the picked. */
  pickedDamage: number;
  /** Damage on everybody else. */
  caughtDamage: number;
  /**
   * Pets and deployables this cast killed, most-killed first.
   *
   * The half of the mechanic's cost that is bought with gold rather than health:
   * across six probed reports it killed 60 of them — thornlings, goblin land
   * mines, flame turrets, snakes and hunter pets. Invisible until the damage was
   * fetched with a data type that includes pets at all.
   */
  kitKilled: PairingCount[];
  /** Damage it dealt pets and deployables, killed or not. */
  petDamage: number;
}

/** One raider's night against one pull's worth of casts, ready to draw on a lane. */
export interface PairingLane extends PairingActor {
  /** Casts that picked them, in time order. */
  picks: { atMs: number; heldMs?: number; damage: number }[];
  /** Casts that caught them in the damage without picking them, in time order. */
  caught: { atMs: number; damage: number }[];
  /** Everything the mechanic cost them on this pull. Raider damage only. */
  damage: number;
  /** What it cost their kit: damage to their pets and deployables. */
  petDamage: number;
  /** Their pets and deployables it killed, most-killed first. */
  kitKilled: PairingCount[];
}

export interface PairingFight {
  fightId: number;
  /** The casts, in the order they went out. */
  casts: PairingCast[];
  /** A lane per raider the mechanic reached, most picked first. */
  lanes: PairingLane[];
  /** Casts on this pull. */
  total: number;
  /** Names picked across them — not the same as `total × 3`; see the header. */
  picks: number;
  /** Everything it dealt on this pull. */
  damage: number;
}

/** One raider across the night. Counts and damage; nothing graded. */
export interface PairingTally extends PairingActor {
  /** Casts that picked them. */
  picks: number;
  /** Damage taken while holding the debuff. */
  pickedDamage: number;
  /** Casts that caught them in the damage without picking them. */
  caught: number;
  /** Damage taken that way. */
  caughtDamage: number;
  /** Damage it dealt their pets and deployables. */
  petDamage: number;
  /** How many of those it killed. */
  petsKilled: number;
}

/** A mechanic seen tonight, with the boss the curated list records for it. */
export interface PairingMechanic {
  spell: string;
  boss?: string;
  casts: number;
}

export interface RaidPairingView {
  /** Pulls that saw a cast, in pull order. */
  fights: PairingFight[];
  /** Everybody the mechanic reached tonight, most picks first. */
  night: PairingTally[];
  /** Which mechanics were seen, biggest first. */
  mechanics: PairingMechanic[];
  /**
   * Casts across the night. Zero is the ambiguous case and the board has to say
   * so: a report imported before the two pairing fetches existed holds none,
   * and so does a night the raid never met one of these bosses. Only a
   * re-import tells them apart.
   */
  total: number;
  /** Names picked across those casts. */
  picks: number;
  /** Damage on raiders holding the debuff. */
  pickedDamage: number;
  /**
   * Damage on raiders who were never picked — the half a debuff-only view
   * cannot see, and on the probed nights the larger one.
   */
  caughtDamage: number;
  /** Damage it dealt pets and deployables across the night. */
  petDamage: number;
  /** Everything of theirs it killed, most-killed first. */
  kitKilled: PairingCount[];
}

export interface PairingInput {
  /** Pull rows — already filtered to the pulls that count. */
  rows: WclPlayerFight[];
  /** Lowercased actor name → roster slug, for deep-linking matched raiders. */
  slugByActor?: Map<string, string>;
}

/** One row's entry, carrying the raider it belongs to through the clustering. */
interface Hit {
  atMs: number;
  spell: string;
  spellId: number;
  picked: boolean;
  heldMs?: number;
  damage: number;
  petDamage: number;
  petsKilled: string[];
  actor: PairingActor;
}

/** A name→count map as a sorted list, biggest first. */
function countsOf(map: Map<string, number>): PairingCount[] {
  return [...map]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name));
}

export function buildPairingView(input: PairingInput): RaidPairingView {
  const slugOf = (name: string) => input.slugByActor?.get(name.toLowerCase());
  const classByActor = new Map<string, string | undefined>();
  for (const r of input.rows) if (r.className) classByActor.set(r.actorName, r.className);

  const actorOf = (name: string): PairingActor => {
    const slug = slugOf(name);
    const className = classByActor.get(name);
    return { name, ...(slug ? { slug } : {}), ...(className ? { className } : {}) };
  };

  /* ---- Gather every hit, per pull ---- */
  const hitsByFight = new Map<number, Hit[]>();
  for (const row of input.rows) {
    if (row.pairings.length === 0) continue;
    const list = hitsByFight.get(row.fightId) ?? [];
    for (const p of row.pairings) {
      list.push({
        atMs: p.atMs,
        spell: p.spell,
        spellId: p.spellId,
        picked: p.picked,
        ...(p.heldMs !== undefined ? { heldMs: p.heldMs } : {}),
        damage: p.damage,
        petDamage: p.petDamage,
        petsKilled: p.petsKilled,
        actor: actorOf(row.actorName),
      });
    }
    hitsByFight.set(row.fightId, list);
  }

  const nightTallies = new Map<string, PairingTally>();
  const mechanics = new Map<string, PairingMechanic>();
  let total = 0;
  let picks = 0;
  let pickedDamage = 0;
  let caughtDamage = 0;
  let petDamage = 0;
  const nightKit = new Map<string, number>();

  const tallyFor = (actor: PairingActor): PairingTally => {
    const existing = nightTallies.get(actor.name);
    if (existing) {
      existing.className ??= actor.className;
      existing.slug ??= actor.slug;
      return existing;
    }
    const fresh: PairingTally = {
      ...actor,
      picks: 0,
      pickedDamage: 0,
      caught: 0,
      caughtDamage: 0,
      petDamage: 0,
      petsKilled: 0,
    };
    nightTallies.set(actor.name, fresh);
    return fresh;
  };

  const fights: PairingFight[] = [...hitsByFight]
    .map(([fightId, hits]) => {
      /*
       * The clustering. Sorted by time, then cut wherever the gap exceeds the
       * window — which on real data means cut at every gap, because the gaps
       * are twenty seconds and the spreads are single-digit milliseconds.
       *
       * Rows are grouped across RAIDERS here, which is the whole trick: three
       * rows carrying the same `atMs` are three people the boss linked, and
       * nothing had to store that fact.
       */
      const sorted = [...hits].sort(
        (a, b) => a.atMs - b.atMs || compareText(a.actor.name, b.actor.name),
      );
      const clusters: Hit[][] = [];
      for (const hit of sorted) {
        const current = clusters[clusters.length - 1];
        if (current && hit.atMs - current[current.length - 1].atMs <= PAIRING_CLUSTER_MS) {
          current.push(hit);
        } else {
          clusters.push([hit]);
        }
      }

      const casts: PairingCast[] = clusters.map((cluster) => {
        const member = (h: Hit): PairingMember => ({
          ...h.actor,
          ...(h.heldMs !== undefined ? { heldMs: h.heldMs } : {}),
          damage: h.damage,
          petDamage: h.petDamage,
          petsKilled: h.petsKilled.length,
        });
        const picked = cluster.filter((h) => h.picked);
        /*
         * A raider is only "caught" if the mechanic damaged THEM. Somebody
         * whose thornling died while they stood clear appears in `kitKilled`
         * and nowhere else — putting them here would read as a positioning
         * mistake the log never claimed.
         */
        const caught = cluster.filter((h) => !h.picked && h.damage > 0);
        const kit = new Map<string, number>();
        for (const h of cluster) {
          for (const name of h.petsKilled) {
            kit.set(name, (kit.get(name) ?? 0) + 1);
            nightKit.set(name, (nightKit.get(name) ?? 0) + 1);
          }
        }
        const curated = pairingOf(cluster[0].spellId);
        const cast: PairingCast = {
          // The earliest row in the cluster. They differ by a few milliseconds
          // at most, and taking the first keeps the lane markers and the cast
          // list agreeing on one number.
          atMs: cluster[0].atMs,
          spell: cluster[0].spell,
          ...(curated?.boss ? { boss: curated.boss } : {}),
          picked: picked.map(member).sort((a, b) => compareText(a.name, b.name)),
          caught: caught
            .map(member)
            .sort((a, b) => b.damage - a.damage || compareText(a.name, b.name)),
          pickedDamage: picked.reduce((sum, h) => sum + h.damage, 0),
          caughtDamage: caught.reduce((sum, h) => sum + h.damage, 0),
          kitKilled: countsOf(kit),
          petDamage: cluster.reduce((sum, h) => sum + h.petDamage, 0),
        };

        total++;
        picks += cast.picked.length;
        pickedDamage += cast.pickedDamage;
        caughtDamage += cast.caughtDamage;
        petDamage += cast.petDamage;
        const mech = mechanics.get(cast.spell) ?? {
          spell: cast.spell,
          ...(curated?.boss ? { boss: curated.boss } : {}),
          casts: 0,
        };
        mech.casts++;
        mechanics.set(cast.spell, mech);

        for (const h of cluster) {
          const tally = tallyFor(h.actor);
          if (h.picked) {
            tally.picks++;
            tally.pickedDamage += h.damage;
          } else if (h.damage > 0) {
            tally.caught++;
            tally.caughtDamage += h.damage;
          }
          tally.petDamage += h.petDamage;
          tally.petsKilled += h.petsKilled.length;
        }
        return cast;
      });

      /* ---- A lane per raider, from the same hits ---- */
      const laneByActor = new Map<string, PairingLane>();
      const laneKit = new Map<string, Map<string, number>>();
      for (const hit of sorted) {
        const lane =
          laneByActor.get(hit.actor.name) ??
          { ...hit.actor, picks: [], caught: [], damage: 0, petDamage: 0, kitKilled: [] };
        if (hit.picked) {
          lane.picks.push({
            atMs: hit.atMs,
            ...(hit.heldMs !== undefined ? { heldMs: hit.heldMs } : {}),
            damage: hit.damage,
          });
        } else if (hit.damage > 0) {
          lane.caught.push({ atMs: hit.atMs, damage: hit.damage });
        }
        lane.damage += hit.damage;
        lane.petDamage += hit.petDamage;
        const kit = laneKit.get(hit.actor.name) ?? new Map<string, number>();
        for (const name of hit.petsKilled) kit.set(name, (kit.get(name) ?? 0) + 1);
        laneKit.set(hit.actor.name, kit);
        laneByActor.set(hit.actor.name, lane);
      }
      for (const [name, lane] of laneByActor) lane.kitKilled = countsOf(laneKit.get(name) ?? new Map());

      return {
        fightId,
        casts,
        lanes: [...laneByActor.values()].sort(
          (a, b) =>
            b.picks.length - a.picks.length ||
            b.damage - a.damage ||
            compareText(a.name, b.name),
        ),
        total: casts.length,
        picks: casts.reduce((sum, c) => sum + c.picked.length, 0),
        damage: casts.reduce((sum, c) => sum + c.pickedDamage + c.caughtDamage, 0),
      };
    })
    .sort((a, b) => a.fightId - b.fightId);

  return {
    fights,
    night: [...nightTallies.values()].sort(
      (a, b) =>
        b.picks - a.picks ||
        b.pickedDamage + b.caughtDamage - (a.pickedDamage + a.caughtDamage) ||
        compareText(a.name, b.name),
    ),
    mechanics: [...mechanics.values()].sort(
      (a, b) => b.casts - a.casts || compareText(a.spell, b.spell),
    ),
    total,
    picks,
    pickedDamage,
    caughtDamage,
    petDamage,
    kitKilled: countsOf(nightKit),
  };
}
