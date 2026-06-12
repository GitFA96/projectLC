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
import type { Character } from "@/lib/types";

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

export function CharacterForm({ character }: { character?: Character }) {
  const [state, formAction, pending] = React.useActionState<CharacterFormState, FormData>(
    saveCharacter,
    {},
  );
  const v = (key: string, fallback?: string) => state.values?.[key] ?? fallback ?? "";
  const isEdit = character !== undefined;

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
        <form action={formAction} className="space-y-4">
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
              <FormSelect name="status" defaultValue={v("status", character?.status ?? "main")}>
                {CHARACTER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </FormSelect>
            </Field>
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
