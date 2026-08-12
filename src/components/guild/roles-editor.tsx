"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Plus, Shield, Trash2 } from "lucide-react";
import {
  createRoleAction,
  deleteRoleAction,
  updateRoleAction,
  type RolesActionResult,
} from "@/app/guild/roles/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  expandCapabilities,
  GUILD_MASTER_EQUIVALENT,
  NEVER_BASELINE,
  type Capability,
} from "@/lib/auth/capabilities";
import type { RoleRow } from "@/lib/analysis/members";
import { cn } from "@/lib/utils";

/**
 * What this guild's roles mean.
 *
 * Grouped and in plain language rather than a flat list of `loot.award` —
 * `CAPABILITIES` already carries a label and a sentence of officer-facing copy
 * for every entry, which is what those fields were for. The raw id is still
 * shown, small: it is what the audit log and the docs say, and an officer
 * comparing the two should not have to guess they are the same thing.
 *
 * The one thing this screen must not do is let somebody tick a box whose
 * consequence it has not stated. Three of them get said out loud:
 *
 *   - an implied capability, which arrives whether or not you asked for it
 *   - `roles.manage`, which is ownership wearing a smaller name
 *   - anything on the baseline, because every member holds the baseline
 */

function ResultLine({ result }: { result: RolesActionResult | null }) {
  if (!result) return null;
  return (
    <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
      {result.message}
    </p>
  );
}

/**
 * The capabilities a set of ticks drags in behind it.
 *
 * Shown as on-but-locked rather than silently added: "may award loot but may
 * not see the ledger" is a state a checkbox grid produces by accident, and it
 * fails as a blank page rather than as a denial. Computed from the vocabulary,
 * never stored — see the note on `RoleRow.capabilities`.
 */
function impliedBy(ticked: readonly Capability[]): Set<Capability> {
  const implied = new Set(expandCapabilities(ticked));
  for (const c of ticked) implied.delete(c);
  return implied;
}

function CapabilityGrid({
  ticked,
  baseline,
  onToggle,
  disabled,
}: {
  ticked: Capability[];
  baseline: boolean;
  onToggle: (capability: Capability, on: boolean) => void;
  disabled?: boolean;
}) {
  const implied = impliedBy(ticked);

  return (
    <div className="space-y-4">
      {CAPABILITY_GROUPS.map((group) => {
        const entries = (Object.keys(CAPABILITIES) as Capability[]).filter(
          (id) => CAPABILITIES[id].group === group.id,
        );
        if (entries.length === 0) return null;

        return (
          <div key={group.id} className="space-y-1.5">
            <div>
              <p className="text-sm font-medium">{group.label}</p>
              <p className="text-xs text-muted-foreground">{group.blurb}</p>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {entries.map((id) => {
                const meta = CAPABILITIES[id];
                const isImplied = implied.has(id);
                const forbidden = baseline && NEVER_BASELINE.includes(id);
                const owning = GUILD_MASTER_EQUIVALENT.includes(id);
                const on = ticked.includes(id) || isImplied;

                return (
                  <label
                    key={id}
                    className={cn(
                      "flex gap-2 rounded-md border p-2",
                      forbidden && "opacity-50",
                      owning && !forbidden && "border-warn-line bg-warn-soft",
                    )}
                    title={forbidden ? "Every member holds the baseline, so this can't go in it." : undefined}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={on}
                      // An implied capability is not a choice — unticking it
                      // would be a lie, since the grant that pulled it in is
                      // still there.
                      disabled={disabled || isImplied || forbidden}
                      onChange={(e) => onToggle(id, e.target.checked)}
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm">{meta.label}</span>
                        {meta.kind === "write" && <Badge variant="muted">write</Badge>}
                        {isImplied && (
                          <Badge variant="secondary" title="Comes with something else you ticked">
                            implied
                          </Badge>
                        )}
                        {owning && (
                          <Badge variant="warning" className="gap-1">
                            <Shield className="h-3 w-3" />
                            owner-equivalent
                          </Badge>
                        )}
                      </span>
                      <span className="block text-xs text-muted-foreground">{meta.gates}</span>
                      <code className="block font-mono text-[10px] text-muted-foreground">{id}</code>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleCard({ role }: { role: RoleRow }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(role.name);
  const [ticked, setTicked] = React.useState<Capability[]>(role.capabilities);
  const [result, setResult] = React.useState<RolesActionResult | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  /*
   * No effect syncing props back into this state, on purpose.
   *
   * The obvious version — re-seed whenever `role` changes — reruns on every
   * render, because `role.capabilities` is a fresh array each time the server
   * sends one, and it would throw away whatever an officer was halfway through
   * ticking. It is not needed either: after a save the local state already
   * matches what came back, so `dirty` settles to false on its own. Discard is
   * the deliberate way back to the server's version.
   */

  const dirty =
    name !== role.name ||
    ticked.length !== role.capabilities.length ||
    ticked.some((c) => !role.capabilities.includes(c));

  const run = (fn: () => Promise<RolesActionResult>) => {
    setResult(null);
    startTransition(async () => {
      const next = await fn();
      setResult(next);
      if (next.ok) router.refresh();
    });
  };

  const grantsWrites = ticked.filter((c) => CAPABILITIES[c].kind === "write");

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {role.name}
            {role.baseline && (
              <Badge variant="secondary" title="Every member holds this, without being given it">
                baseline
              </Badge>
            )}
            <Badge variant="muted">
              {role.memberCount} {role.memberCount === 1 ? "member" : "members"}
            </Badge>
          </CardTitle>
          {!role.baseline && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => (confirmDelete ? run(() => deleteRoleAction(role.id)) : setConfirmDelete(true))}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDelete ? "Really delete?" : "Delete"}
            </Button>
          )}
        </div>
        {role.baseline && (
          <p className="text-xs text-muted-foreground">
            The floor everybody stands on. It can be renamed and its grants changed — what every
            member gets is this guild&apos;s decision — but it can&apos;t be deleted, and it
            can&apos;t hand out permissions.
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor={`name-${role.id}`}>Name</Label>
          <Input
            id={`name-${role.id}`}
            value={name}
            maxLength={40}
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <CapabilityGrid
          ticked={ticked}
          baseline={role.baseline}
          disabled={pending}
          onToggle={(capability, on) =>
            setTicked((prev) => (on ? [...prev, capability] : prev.filter((c) => c !== capability)))
          }
        />

        {role.baseline && grantsWrites.length > 0 && (
          <p className="flex gap-2 rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Every member of this guild will be able to{" "}
              {grantsWrites.map((c) => CAPABILITIES[c].label.toLowerCase()).join(", ")}. That may be
              exactly what you want — it is your call, not the app&apos;s — but it applies to
              everybody, including whoever joins next.
            </span>
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!dirty || pending}
            onClick={() => run(() => updateRoleAction(role.id, { name, capabilities: ticked }))}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
          {dirty && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setName(role.name);
                setTicked(role.capabilities);
                setResult(null);
              }}
            >
              Discard
            </Button>
          )}
          <ResultLine result={result} />
        </div>
      </CardContent>
    </Card>
  );
}

function NewRole() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [ticked, setTicked] = React.useState<Capability[]>([]);
  const [result, setResult] = React.useState<RolesActionResult | null>(null);

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        New role
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New role</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="new-role-name">Name</Label>
          <Input
            id="new-role-name"
            value={name}
            maxLength={40}
            placeholder="Class Lead"
            disabled={pending}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <CapabilityGrid
          ticked={ticked}
          baseline={false}
          disabled={pending}
          onToggle={(capability, on) =>
            setTicked((prev) => (on ? [...prev, capability] : prev.filter((c) => c !== capability)))
          }
        />

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!name.trim() || pending}
            onClick={() => {
              setResult(null);
              startTransition(async () => {
                const next = await createRoleAction({ name, capabilities: ticked });
                setResult(next);
                if (next.ok) {
                  setOpen(false);
                  setName("");
                  setTicked([]);
                  router.refresh();
                }
              });
            }}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Create
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <ResultLine result={result} />
        </div>
      </CardContent>
    </Card>
  );
}

export function RolesEditor({ roles, ownerCount }: { roles: RoleRow[]; ownerCount: number }) {
  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
        <p>
          A role is a bundle of permissions with a name this guild chose. The names and the bundles
          are yours; the permissions themselves are fixed by what the app actually checks, which is
          why you can&apos;t invent one — inventing it would grant nothing.
        </p>
        <p className="mt-2">
          {ownerCount === 1 ? "The owner holds" : `All ${ownerCount} owners hold`} every permission
          regardless of roles, and cannot be stripped of any. That is what makes it impossible to
          lock this guild out of itself.
        </p>
      </div>

      {roles.map((role) => (
        <RoleCard key={role.id} role={role} />
      ))}

      <NewRole />
    </div>
  );
}
