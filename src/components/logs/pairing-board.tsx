"use client";

import * as React from "react";
import type { RaidFight } from "@/lib/types";
import type { PairingCast, PairingCount, RaidPairingView } from "@/lib/analysis/pairings";
import { Raider } from "@/components/logs/rank-bits";
import { mmss, TimeAxis, TimelineLane, timeTicks } from "@/components/logs/timeline-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Who the boss linked together, and who was standing in it.
 *
 * Mother Shahraz's Fatal Attraction is the mechanic this was built for, and it
 * sits beside the deployables because that card is already the Shahraz card.
 *
 * Two things drive the layout. The pairing itself is a **set of names at one
 * moment**, so the cast list is the primary reading and the timeline is there
 * to show the rhythm — a pull is five or six casts twenty-five seconds apart,
 * and which pair drew each one is the officers' question. And the damage has
 * **two audiences**: the pair, who are supposed to run, and everybody the AoE
 * caught, who on every night probed took more of it than the pair did.
 *
 * Nothing here grades anybody. Being picked is something the boss does, and
 * what a pairing *should* have cost is a judgement about positioning the log
 * cannot make — see `analysis/pairings.ts` and invariant 5.
 */

/**
 * A colour per cast, so one pairing reads as one colour down every lane it
 * touches — that is the only thing on the timeline that says these three
 * raiders were linked to each other rather than picked at the same time.
 *
 * From the validated graph slots rather than chosen (chains §9): these values
 * are checked for both themes, and a hex in a `style` attribute would be wrong
 * in dark mode with nothing to catch it.
 */
const CAST_SLOTS = [
  "var(--graph-series-1)",
  "var(--graph-series-2)",
  "var(--graph-series-3)",
  "var(--graph-series-4)",
];

const castColor = (index: number) => CAST_SLOTS[index % CAST_SLOTS.length];

const num = (n: number) => Math.round(n).toLocaleString("en-US");

/** "4.0s" — a hold is seconds long, and rounding it to whole ones loses the story. */
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The picked, as names joined the way an officer says them out loud. */
function CastNames({ cast, color }: { cast: PairingCast; color: string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span
        aria-hidden
        className="h-2 w-2 shrink-0 rotate-45 rounded-[1px]"
        style={{ backgroundColor: color }}
      />
      {cast.picked.map((p, i) => (
        <span key={p.name} className="whitespace-nowrap">
          <Raider name={p.name} slug={p.slug} className={p.className} />
          {p.heldMs !== undefined && (
            <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">
              {secs(p.heldMs)}
            </span>
          )}
          {i < cast.picked.length - 1 && <span className="ml-1.5 text-muted-foreground">+</span>}
        </span>
      ))}
    </span>
  );
}

/**
 * "9 Goblin Land Mine · 1 Thornling" — what a cast destroyed.
 *
 * Plain text rather than the swatch-and-count the deployables tab uses: these
 * are the same five devices, but here they are casualties rather than presses,
 * and reusing the colour key would suggest the two tallies add up.
 */
function KitList({ kit }: { kit: PairingCount[] }) {
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {kit.map((k) => (
        <span key={k.name} className="whitespace-nowrap">
          <span className="tabular-nums">{k.count}</span> {k.name}
        </span>
      ))}
    </span>
  );
}

export function PairingSections({
  fights,
  pairings,
}: {
  fights: RaidFight[];
  pairings: RaidPairingView;
}) {
  const withCasts = fights.filter((f) => pairings.fights.some((p) => p.fightId === f.fightId));

  if (pairings.total === 0 || withCasts.length === 0) {
    return (
      <div className="space-y-2 py-1">
        <p className="text-sm text-muted-foreground">
          No pairing mechanic recorded for this night. That is <em>not</em> the same as a night
          nobody was picked: this needs two separate fetches that reports imported before it never
          made, so they contain no events for it at all. Re-import this report to fill it in — and a
          night that never met Mother Shahraz will still say this.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {pairings.mechanics.map((m) => (
          <span key={m.spell} className="whitespace-nowrap">
            <span className="font-medium text-foreground">{m.spell}</span>
            {m.boss && <span> · {m.boss}</span>}
            <span className="tabular-nums"> · {m.casts} casts</span>
          </span>
        ))}
        <span className="whitespace-nowrap tabular-nums">
          {pairings.picks} picked · {num(pairings.pickedDamage)} damage on them,{" "}
          {num(pairings.caughtDamage)} on everybody else
        </span>
        {pairings.kitKilled.length > 0 && (
          <span className="whitespace-nowrap">
            and it killed <KitList kit={pairings.kitKilled} />
          </span>
        )}
      </p>

      <Tabs defaultValue={String(withCasts[0].fightId)}>
        <TabsList className="h-auto flex-wrap justify-start">
          {withCasts.map((f) => (
            <TabsTrigger key={f.fightId} value={String(f.fightId)}>
              {f.encounterName}
              {!f.kill && (
                <span className="text-[10px] text-warn-ink">
                  {f.fightPercentage !== undefined ? `${Math.round(f.fightPercentage)}%` : "wipe"}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {withCasts.map((fight) => {
          const pull = pairings.fights.find((p) => p.fightId === fight.fightId);
          const casts = pull?.casts ?? [];
          const { ticks } = timeTicks(fight.durationMs);
          /* Which colour each cast took, by the moment it went out — the lanes
             and the list below have to agree on it or the colour says nothing. */
          const colorAt = new Map(casts.map((c, i) => [c.atMs, castColor(i)]));

          return (
            <TabsContent key={fight.fightId} value={String(fight.fightId)} className="space-y-1">
              <TimeAxis durationMs={fight.durationMs} ticks={ticks} />
              {(pull?.lanes ?? []).map((lane) => (
                <TimelineLane
                  key={lane.name}
                  label={<Raider name={lane.name} slug={lane.slug} className={lane.className} />}
                  /* A band is the window they actually held it for — the thing
                     an officer is looking at is how long it took them to get
                     apart, and a pip cannot show a duration. */
                  bands={lane.picks
                    .filter((p) => p.heldMs !== undefined)
                    .map((p) => ({
                      segments: [[p.atMs, p.atMs + (p.heldMs ?? 0)]] as [number, number][],
                      color: colorAt.get(p.atMs) ?? "var(--foreground)",
                      label: `picked · ${secs(p.heldMs ?? 0)} · ${num(p.damage)}`,
                    }))}
                  /* Hollow, the same convention the interrupt board uses for a
                     press that stopped nothing: the cast reached them, but it
                     did not pick them. Shape rather than colour, because colour
                     already carries which cast this was. */
                  markers={lane.caught.map((c) => ({
                    atMs: c.atMs,
                    color: colorAt.get(c.atMs) ?? "var(--foreground)",
                    hollow: true,
                    label: `caught in it · ${num(c.damage)}`,
                  }))}
                  pct={0}
                  durationMs={fight.durationMs}
                  ticks={ticks}
                  trailing={
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {num(lane.damage)}
                    </span>
                  }
                />
              ))}

              <div className="pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">At</TableHead>
                      <TableHead>Linked</TableHead>
                      <TableHead className="w-24 text-right">On the pair</TableHead>
                      <TableHead className="w-40 text-right">Caught in it</TableHead>
                      <TableHead className="w-44">Kit killed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {casts.map((cast, i) => (
                      <TableRow key={`${cast.atMs}-${i}`}>
                        <TableCell className="tabular-nums text-muted-foreground">
                          {mmss(cast.atMs)}
                        </TableCell>
                        <TableCell>
                          <CastNames cast={cast} color={castColor(i)} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(cast.pickedDamage)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {cast.caught.length === 0 ? (
                            <span className="text-muted-foreground/50">nobody</span>
                          ) : (
                            <span
                              className="tabular-nums"
                              title={cast.caught
                                .map((c) => `${c.name} ${num(c.damage)}`)
                                .join(", ")}
                            >
                              {cast.caught.length} · {num(cast.caughtDamage)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {cast.kitKilled.length === 0 ? (
                            <span className="text-muted-foreground/50">—</span>
                          ) : (
                            <KitList kit={cast.kitKilled} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="pt-1 text-xs text-muted-foreground/70">
                <Badge variant="muted" className="mr-1.5 font-normal">
                  note
                </Badge>
                A cast is shown with as many names as the log gave it. She rolls three targets over
                the whole raid and a roll that lands on a tank is lost — no tank has ever been picked
                across sixteen reports — so a two-name pairing is a roll that hit a tank, not a name
                that went missing. Only <em>players</em> are ever picked — no pet or deployable has
                ever taken the debuff, and how many are alive makes no difference to how many names
                she picks — but the damage is an AoE that hits them too, and &quot;kit killed&quot;
                is what it destroyed on the way.
              </p>
            </TabsContent>
          );
        })}
      </Tabs>

      <NightTable pairings={pairings} />
    </div>
  );
}

/**
 * The night, per raider — and the two columns stay apart on purpose.
 *
 * Being picked and being caught are different facts: the first is the boss
 * choosing you, the second is where you were standing. Adding them into one
 * "Fatal Attraction damage taken" column would read as one failing and hide the
 * only half anybody can do something about.
 */
function NightTable({ pairings }: { pairings: RaidPairingView }) {
  if (pairings.night.length === 0) return null;
  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-medium text-muted-foreground">
        The night, per raider — {pairings.picks} picks across {pairings.total} casts
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Raider</TableHead>
            <TableHead className="w-20 text-right">Picked</TableHead>
            <TableHead className="w-28 text-right">Damage</TableHead>
            <TableHead className="w-20 text-right">Caught</TableHead>
            <TableHead className="w-28 text-right">Damage</TableHead>
            <TableHead className="w-24 text-right">Kit lost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pairings.night.map((r) => (
            <TableRow key={r.name}>
              <TableCell>
                <Raider name={r.name} slug={r.slug} className={r.className} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.picks === 0 ? <span className="text-muted-foreground/50">—</span> : r.picks}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {num(r.pickedDamage)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.caught === 0 ? <span className="text-muted-foreground/50">—</span> : r.caught}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {num(r.caughtDamage)}
              </TableCell>
              <TableCell
                className="text-right tabular-nums"
                title={r.petDamage > 0 ? `${num(r.petDamage)} damage to their pets` : undefined}
              >
                {r.petsKilled === 0 ? (
                  <span className="text-muted-foreground/50">—</span>
                ) : (
                  r.petsKilled
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
