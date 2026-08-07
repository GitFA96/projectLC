"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw } from "lucide-react";
import { resetPolicyAction, savePolicyAction } from "@/app/loot-policy-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GuildPolicy } from "@/lib/analysis/policy";

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
  alt: {
    label: "Alt",
    help: "Multiplier on an alt's score. 1 ranks alts exactly like mains; the default of 0.7 puts a main ahead on equal metrics.",
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

export function PolicyEditor({ policy }: { policy: GuildPolicy }) {
  const router = useRouter();
  const [draft, setDraft] = React.useState(policy);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await savePolicyAction({
        standing: draft.standing,
        slotServed: draft.slotServed,
        attendance: draft.attendance,
        performance: draft.performance,
        preparation: draft.preparation,
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
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.preparation.elixirCounts}
            onChange={(e) =>
              setDraft((d) => ({ ...d, preparation: { elixirCounts: e.target.checked } }))
            }
            className="mt-0.5"
          />
          <span>
            A single battle elixir counts as coverage
            <span className="block text-xs text-muted-foreground">
              On, a hunter running one elixir rather than a flask reads as covered. Off, only a
              flask does — a stricter standard, and a lot of raiders will drop below it.
            </span>
          </span>
        </label>
      </section>

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
