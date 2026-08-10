"use client";

import Link from "next/link";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import {
  previewPolicyAction,
  resetPolicyAction,
  savePolicyAction,
} from "@/app/loot-policy-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GuildPolicy } from "@/lib/analysis/policy";
import type { PolicyPreview } from "@/lib/analysis/policy-preview";

/**
 * The numbers that decide things, where the council can reach them.
 *
 * Grouped by the argument each one settles rather than by where it lives in
 * code, because an officer opens this after a disagreement, not after reading
 * the source. Each field says what it changes in the sentence beside it — a
 * number with no stated consequence gets tuned at random.
 *
 * The weighting is edited separately, above: it is the one an argument is
 * usually about, and it has its own must-sum-to-something feel. Everything here
 * is independent of everything else.
 */

interface FieldSpec {
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
}

function NumberField({
  spec,
  value,
  onChange,
}: {
  spec: FieldSpec;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_6rem_1fr] sm:items-center sm:gap-3">
      <Label className="text-sm">{spec.label}</Label>
      <Input
        type="number"
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="tabular-nums"
      />
      <p className="text-xs text-muted-foreground">{spec.help}</p>
    </div>
  );
}

const STANDING: Record<string, FieldSpec> = {
  trial: {
    label: "Trial",
    help: "A raider on trial. 1 ranks them exactly like a main — the default, because the app has no view on this. Lower it if loot waits until they pass; some councils gear a trial first instead, which is what leaving it at 1 says.",
    min: 0.01,
    max: 1,
    step: 0.05,
  },
  alt: {
    label: "Alt",
    help: "Multiplier on an alt's score, and only in force when alts contend (above). 1 ranks them exactly like mains; 0.7 puts a main ahead on equal metrics.",
    min: 0.01,
    max: 1,
    step: 0.05,
  },
  inactive: {
    label: "Inactive",
    help: "Someone off the raiding roster who still wants loot.",
    min: 0.01,
    max: 1,
    step: 0.05,
  },
  pug: {
    label: "Pug",
    help: "Not a guild raider. Ranked, but last on equal metrics.",
    min: 0.01,
    max: 1,
    step: 0.05,
  },
};

export function PolicyEditor({
  policy,
  /** Every boss the imported logs have seen — what the excuse list picks from. */
  encounters = [],
}: {
  policy: GuildPolicy;
  encounters?: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(policy);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  /*
   * What the draft would do, measured against the roster before it is saved.
   *
   * Debounced and only while dirty: a preview rebuilds the read model, and
   * there is nothing to preview until something changed. It follows the draft
   * rather than sitting behind a "check" button, because an officer who has to
   * press check before save will press save.
   */
  const [preview, setPreview] = React.useState<PolicyPreview | null>(null);
  React.useEffect(() => {
    if (!dirty) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void previewPolicyAction({
        loot: draft.loot,
        standing: draft.standing,
        slotServed: draft.slotServed,
        attendance: draft.attendance,
        performance: draft.performance,
        preparation: draft.preparation,
        roster: draft.roster,
      }).then((result) => {
        if (!cancelled) setPreview(result);
      });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, dirty]);

  const shownPreview = dirty ? preview : null;

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await savePolicyAction({
        loot: draft.loot,
        standing: draft.standing,
        slotServed: draft.slotServed,
        attendance: draft.attendance,
        performance: draft.performance,
        preparation: draft.preparation,
        roster: draft.roster,
      });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  };

  const reset = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await resetPolicyAction();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Do alts contend for loot?</h3>
          <p className="text-xs text-muted-foreground">
            Off, an alt&apos;s wishlist is still shown beneath the board — named, not ranked —
            because loot goes to the person&apos;s main. On is for a guild running two teams, where
            an alt is somebody&apos;s raiding character.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.loot.altsContend}
            onChange={(e) => setDraft((d) => ({ ...d, loot: { altsContend: e.target.checked } }))}
            className="mt-0.5"
          />
          <span>
            Alts rank alongside mains
            <span className="block text-xs text-muted-foreground">
              This moves everyone&apos;s scores, not just the alts&apos;: &ldquo;loot owed&rdquo; is
              measured against whoever in the contest has taken the most, so a well-fed alt joining
              raises the bar for the whole list. The standing multiplier below then decides how far
              behind a main they sit.
            </span>
          </span>
        </label>
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Roster standing</h3>
          <p className="text-xs text-muted-foreground">
            A category, not a percentage: it multiplies the whole score once the factors are in. A
            multiplier of 1 means that standing costs nothing at all.
          </p>
        </div>
        {(["alt", "inactive", "pug"] as const).map((key) => (
          <NumberField
            key={key}
            spec={STANDING[key]}
            value={draft.standing[key]}
            onChange={(n) => setDraft((d) => ({ ...d, standing: { ...d.standing, [key]: n } }))}
          />
        ))}
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Already served this slot</h3>
          <p className="text-xs text-muted-foreground">
            A wishlist wants one item per slot, but slots keep dropping. Someone already handed
            something for this slot is multiplied down — down, not out, so they still win an
            uncontested drop.
          </p>
        </div>
        <NumberField
          spec={{
            label: "Cost per slot filled",
            help: "How much a fully-served slot costs. 0.4 means a raider who already won for this slot scores 60% of what they otherwise would.",
            min: 0,
            max: 1,
            step: 0.05,
          }}
          value={draft.slotServed.drop}
          onChange={(n) => setDraft((d) => ({ ...d, slotServed: { ...d.slotServed, drop: n } }))}
        />
        <NumberField
          spec={{
            label: "Cost when it was a fallback",
            help: "Same, but for a slot served by something they didn't ask for — a ranked fallback, or a drop off their list. Set it lower than the cost above to say a raider wearing a filler is still waiting. Equal by default, which is how it read before.",
            min: 0,
            max: 1,
            step: 0.05,
          }}
          value={draft.slotServed.fillerDrop}
          onChange={(n) => setDraft((d) => ({ ...d, slotServed: { ...d.slotServed, fillerDrop: n } }))}
        />
        <NumberField
          spec={{
            label: "Cost when they never listed it",
            help: "A drop that was on neither their wishlist nor their ranked fallbacks. Zero by council decision: being handed something nobody asked for shouldn't weaken their claim on the item they did ask for. A raider with no wishlist on record is counted in full instead — we can't tell, and a missing list shouldn't buy a discount.",
            min: 0,
            max: 1,
            step: 0.05,
          }}
          value={draft.slotServed.offListDrop}
          onChange={(n) => setDraft((d) => ({ ...d, slotServed: { ...d.slotServed, offListDrop: n } }))}
        />
        <NumberField
          spec={{
            label: "Floor",
            help: "However many they've won, their score never falls below this share. Stops a repeat winner becoming unrankable.",
            min: 0,
            max: 1,
            step: 0.05,
          }}
          value={draft.slotServed.floor}
          onChange={(n) => setDraft((d) => ({ ...d, slotServed: { ...d.slotServed, floor: n } }))}
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Standing board</h3>
          <p className="text-xs text-muted-foreground">
            How the{" "}
            <Link href="/roster/standing" className="font-medium text-foreground underline-offset-2 hover:underline">
              standing board
            </Link>{" "}
            weighs a raider against the rest of the roster. <strong>Loot owed is not here</strong>{" "}
            — being owed loot is not a demerit. These start equal because the app has no opinion,
            not because equal is right: whether turning up matters more than parsing is your call.
          </p>
        </div>
        {(
          [
            ["attendance", "Attendance"],
            ["performance", "Median parse"],
            ["preparation", "Preparation"],
          ] as const
        ).map(([key, label]) => (
          <NumberField
            key={key}
            spec={{
              label,
              help: "Relative weight. A raider with no figure for a column has it dropped from their average rather than counted as zero.",
              min: 0,
              max: 100,
              step: 1,
            }}
            value={draft.roster.weights[key]}
            onChange={(n) =>
              setDraft((d) => ({
                ...d,
                roster: { ...d.roster, weights: { ...d.roster.weights, [key]: n } },
              }))
            }
          />
        ))}
        <NumberField
          spec={{
            label: "Raids before a raider is placed",
            help: "Below this many logged raids they are listed but left unplaced. A trial with two nights doesn't belong at the bottom of a replace list next to a regular who stopped turning up.",
            min: 0,
            max: 100,
            step: 1,
          }}
          value={draft.roster.minRaids}
          onChange={(n) => setDraft((d) => ({ ...d, roster: { ...d.roster, minRaids: n } }))}
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Attendance windows</h3>
          <p className="text-xs text-muted-foreground">
            <strong>Attendance only</strong> — neither of these touches loot. Loot owed is already
            counted across the whole phase, by raid zone. These decide how far back the{" "}
            <em>recent attendance</em> figure and the weekly dots look.
          </p>
        </div>
        <NumberField
          spec={{
            label: "Recent-attendance window",
            help: "How many of the latest logged raids the recent attendance figure covers. The all-time figure is unaffected.",
            min: 1,
            max: 100,
            step: 1,
          }}
          value={draft.attendance.recentRaids}
          onChange={(n) =>
            setDraft((d) => ({ ...d, attendance: { ...d.attendance, recentRaids: n } }))
          }
        />
        <NumberField
          spec={{
            label: "Weekly dots shown",
            help: "How many reset weeks the per-week attendance dots go back.",
            min: 1,
            max: 52,
            step: 1,
          }}
          value={draft.attendance.weeks}
          onChange={(n) => setDraft((d) => ({ ...d, attendance: { ...d.attendance, weeks: n } }))}
        />
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Which parse the score rides on</h3>
          <p className="text-xs text-muted-foreground">
            They answer different questions, and for a raider in strong gear they differ a lot.
          </p>
        </div>
        <div className="space-y-1.5">
          {(
            [
              ["all", "Parse (all damage)", "What we actually got out of them, against everyone."],
              [
                "bracket",
                "Bracket parse (ilvl)",
                "Against raiders in comparable gear — closer to “are they playing well”.",
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="parseMetric"
                checked={draft.performance.parseMetric === value}
                onChange={() => setDraft((d) => ({ ...d, performance: { parseMetric: value } }))}
                className="mt-0.5"
              />
              <span>
                {label}
                <span className="block text-xs text-muted-foreground">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">What counts as prepared</h3>
          <p className="text-xs text-muted-foreground">
            Feeds the preparation factor in every score, and the flask coverage on every raid page.
          </p>
        </div>
        <div className="space-y-1.5">
          {(
            [
              [
                "any",
                "A flask, or any one elixir",
                "One battle elixir reads as covered. What this roster does — the half-filled sets are still named on the raid page.",
              ],
              [
                "full",
                "A flask, or battle AND guardian",
                "A full set either way. Stricter, and the raiders who run one elixir all night drop below it.",
              ],
              [
                "flaskOnly",
                "Only a flask",
                "Strictest. Wrong for the specs whose best consumables are two elixirs.",
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="coverage"
                checked={draft.preparation.coverage === value}
                onChange={() =>
                  setDraft((d) => ({ ...d, preparation: { ...d.preparation, coverage: value } }))
                }
                className="mt-0.5"
              />
              <span>
                {label}
                <span className="block text-xs text-muted-foreground">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold">Content that doesn&apos;t count</h3>
          <p className="text-xs text-muted-foreground">
            Bosses nobody is expected to burn a flask on &mdash; last phase&apos;s raid, cleared on
            the way past. Their pulls stop counting towards preparation everywhere: the raider&apos;s
            page, the standing board and the loot score. Parses and attendance are untouched, and so
            is the gold, because they were still there.
          </p>
        </div>
        {encounters.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing to choose from until a Warcraft Logs report is imported.
          </p>
        ) : (
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {encounters.map((name) => {
              const on = draft.preparation.excusedEncounters.includes(name);
              return (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        preparation: {
                          ...d.preparation,
                          excusedEncounters: on
                            ? d.preparation.excusedEncounters.filter((e) => e !== name)
                            : [...d.preparation.excusedEncounters, name],
                        },
                      }))
                    }
                  />
                  <span>{name}</span>
                </label>
              );
            })}
          </div>
        )}
        {draft.preparation.excusedEncounters.length > 0 && (
          <p className="text-xs text-muted-foreground">
            A raider whose every pull in a report is excused keeps that report&apos;s preparation
            figures rather than dropping to 0% &mdash; a percentage nobody was asked to earn is
            worse than no exemption at all.
          </p>
        )}
      </section>

      {shownPreview && (
        <div className="space-y-2 rounded-xl border border-warn-line bg-warn-soft p-3 text-warn-ink">
          <p className="text-sm font-medium">
            {shownPreview.moved.length === 0
              ? "This changes no raider's numbers."
              : `This moves ${shownPreview.moved.length} of ${shownPreview.measured} raiders.`}
          </p>

          {shownPreview.avgPreparedBefore !== shownPreview.avgPreparedAfter && (
            <p className="text-xs">
              Guild average preparation{" "}
              <strong className="tabular-nums">{shownPreview.avgPreparedBefore}%</strong> →{" "}
              <strong className="tabular-nums">{shownPreview.avgPreparedAfter}%</strong>
            </p>
          )}

          {shownPreview.toZero.length > 0 && (
            <p className="text-xs">
              <strong>
                {shownPreview.toZero.length}{" "}
                {shownPreview.toZero.length === 1 ? "raider drops" : "raiders drop"} to 0%
              </strong>{" "}
              preparation — they cover with what this rule stops counting:{" "}
              {shownPreview.toZero.slice(0, 6).map((r) => r.name).join(", ")}
              {shownPreview.toZero.length > 6 ? ", …" : ""}
            </p>
          )}

          {shownPreview.moved.length > 0 && shownPreview.toZero.length === 0 && (
            <p className="text-xs">
              Biggest movers:{" "}
              {shownPreview.moved
                .slice(0, 4)
                .map((r) => {
                  const from = r.preparedBefore ?? r.attendanceBefore ?? 0;
                  const to = r.preparedAfter ?? r.attendanceAfter ?? 0;
                  return `${r.name} ${from}% → ${to}%`;
                })
                .join(" · ")}
            </p>
          )}
        </div>
      )}

      {message && (
        <p className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending || !dirty}>
          {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {dirty ? "Save policy" : "Saved"}
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setDraft(policy)} disabled={pending}>
            Discard changes
          </Button>
        )}
        <Button variant="ghost" onClick={reset} disabled={pending} className="ml-auto">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Back to defaults
        </Button>
      </div>
    </div>
  );
}
