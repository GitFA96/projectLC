"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CHARACTER_STATUSES, ROLES, STATUS_LABELS, WOW_CLASSES } from "@/lib/constants/wow";
import { saveCharacter, type CharacterFormState } from "@/app/characters/actions";
import type { Character, Role } from "@/lib/types";

/** Native select so values always travel with the form post (no JS required). */
function FormSelect({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Slim main-candidate option (any other guild character). */
export interface MainOption {
  id: string;
  name: string;
  wowClass: string;
}

/** A spec their logs show them raiding in, with how much. */
export interface SeenSpec {
  spec: string;
  /** Suggested role, when the log's own role is unambiguous. */
  role?: Role;
  pulls: number;
  /** True when this is the spec the roster already records as their main. */
  isMain: boolean;
}

/**
 * The character form's DOM id, so fields living in a different card can still
 * post with it via the native `form` attribute. Off-spec is one field pair and
 * a whole gear kit, which belongs next to the gear rather than buried in the
 * identity form — but it's still one character, saved in one write.
 */
export const CHARACTER_FORM_ID = "character-form";

export function CharacterForm({
  character,
  mains = [],
}: {
  character?: Character;
  /** Guild characters this one could be an alt of (excludes self / pugs). */
  mains?: MainOption[];
}) {
  const [state, formAction, pending] = React.useActionState<CharacterFormState, FormData>(
    saveCharacter,
    {},
  );
  const v = (key: string, fallback?: string) => state.values?.[key] ?? fallback ?? "";
  const isEdit = character !== undefined;
  const [status, setStatus] = React.useState<string>(v("status", character?.status ?? "main"));

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{isEdit ? `Edit ${character.name}` : "New character"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {isEdit
            ? "Gear sets, loot and log history follow the character — renaming keeps everything. Raiders who left are set to “inactive”, never deleted; off-roster regulars are “pug”. Past loot decisions stay explainable."
            : "Add a raider so imports can target them and Gargul winners resolve to a profile. Use status “pug” for off-roster regulars (PUGs, friends' alts)."}
        </p>
      </CardHeader>
      <CardContent>
        <form id={CHARACTER_FORM_ID} action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={character?.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" required defaultValue={v("name", character?.name)} className="h-8" />
            </Field>
            <Field label="Race (optional)">
              <Input
                name="race"
                defaultValue={v("race", character?.race)}
                placeholder="Orc, Blood Elf…"
                className="h-8"
              />
            </Field>
            <Field label="Class">
              <FormSelect name="class" required defaultValue={v("class", character?.class)}>
                {WOW_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label="Spec">
              <Input
                name="spec"
                required
                defaultValue={v("spec", character?.spec)}
                placeholder="Protection, Beast Mastery…"
                className="h-8"
              />
            </Field>
            <Field label="Role">
              <FormSelect name="role" required defaultValue={v("role", character?.role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </FormSelect>
            </Field>
            <Field label="Status">
              <FormSelect
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {CHARACTER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </FormSelect>
            </Field>
            {status === "alt" && (
              <Field label="Alt of (main)">
                <FormSelect
                  name="mainCharacterId"
                  defaultValue={v("mainCharacterId", character?.mainCharacterId ?? "")}
                >
                  <option value="">— no main set —</option>
                  {mains.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.wowClass})
                    </option>
                  ))}
                </FormSelect>
              </Field>
            )}
          </div>
          <Field label="Note (optional)">
            <Input
              name="note"
              defaultValue={v("note", character?.note)}
              placeholder="Loot council remarks, attendance…"
              className="h-8"
            />
          </Field>

          {state.error && (
            <p className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              {state.error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Add character"}
            </Button>
            <Button asChild variant="ghost">
              <Link
                href={
                  isEdit ? `/characters/${encodeURIComponent(character.name.toLowerCase())}` : "/roster"
                }
              >
                Cancel
              </Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The off-spec a raider actually steps into for the guild.
 *
 * It sits with the gear rather than inside the identity form, because that's
 * what it's for: naming a second spec is what makes the off-spec gear kit
 * appear below. The fields still belong to the character form — the native
 * `form` attribute posts them with it — so an off-spec is never a second,
 * half-saved record of the same raider.
 */
export function OffSpecCard({
  character,
  seenSpecs = [],
}: {
  character?: Character;
  /** Specs found in their logs — the evidence an off-spec exists at all. */
  seenSpecs?: SeenSpec[];
}) {
  // Controlled so the "seen in their logs" suggestions can fill both at once.
  const [offSpec, setOffSpec] = React.useState<string>(character?.offSpec ?? "");
  const [offSpecRole, setOffSpecRole] = React.useState<string>(character?.offSpecRole ?? "");
  const saved = character?.offSpec ?? "";
  const dirty = offSpec.trim() !== saved || (offSpecRole || "") !== (character?.offSpecRole ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Off-spec (optional)</CardTitle>
        <p className="text-xs text-muted-foreground">
          A second spec they actually raid in. Recording it stops their off-spec nights reading as a
          roster error, tells the council which pool their loot sits in, and opens a separate gear
          kit for what they field in that role.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Off-spec">
            <Input
              name="offSpec"
              form={CHARACTER_FORM_ID}
              value={offSpec}
              onChange={(e) => setOffSpec(e.target.value)}
              placeholder="Protection, Restoration…"
              className="h-8"
            />
          </Field>
          <Field label="Off-spec role">
            <FormSelect
              name="offSpecRole"
              form={CHARACTER_FORM_ID}
              value={offSpecRole}
              onChange={(e) => setOffSpecRole(e.target.value)}
              disabled={offSpec.trim() === ""}
            >
              <option value="">— pick a role —</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </FormSelect>
          </Field>
        </div>
        {seenSpecs.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Seen in their logs:{" "}
            {seenSpecs.map((s, i) => (
              <React.Fragment key={s.spec}>
                {i > 0 && ", "}
                {s.isMain ? (
                  <span title="Already their main spec">
                    {s.spec} ({s.pulls} pulls, main)
                  </span>
                ) : (
                  <button
                    type="button"
                    className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline"
                    onClick={() => {
                      setOffSpec(s.spec);
                      if (s.role) setOffSpecRole(s.role);
                    }}
                    title={`Use ${s.spec} as the off-spec`}
                  >
                    {s.spec} ({s.pulls} pulls)
                  </button>
                )}
              </React.Fragment>
            ))}
            {seenSpecs.every((s) => s.isMain) && " — only their main spec so far."}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* Same form, different card — the save has to be reachable from here. */}
          <Button type="submit" form={CHARACTER_FORM_ID} variant="outline" size="sm" className="h-7">
            Save off-spec
          </Button>
          {offSpec.trim() !== "" && (
            <button
              type="button"
              onClick={() => {
                setOffSpec("");
                setOffSpecRole("");
              }}
              className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear off-spec
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">
            {dirty
              ? "Unsaved — this saves the character card too."
              : saved
                ? "The gear kit below follows this spec."
                : "Saved with the character card."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
