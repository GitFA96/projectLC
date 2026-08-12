"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { setGuildIdentityAction } from "@/app/guild-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The guild's own name, realm and faction.
 *
 * Nothing edited these before — `guild.edit` claimed to gate "name, realm,
 * faction and the active phase" while only the phase had a control, which made
 * the capability's own description the most misleading copy in the app.
 *
 * A realm transfer is the real case. The alternative was editing the database.
 */
export function GuildIdentityEditor({
  name: initialName,
  realm: initialRealm,
  faction: initialFaction,
}: {
  name: string;
  realm: string;
  faction: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(initialName);
  const [realm, setRealm] = React.useState(initialRealm);
  const [faction, setFaction] = React.useState(initialFaction);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  const dirty = name !== initialName || realm !== initialRealm || faction !== initialFaction;

  return (
    <div className="space-y-3">
      <div className="grid max-w-2xl gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="guild-name">Name</Label>
          <Input id="guild-name" value={name} maxLength={60} disabled={pending} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guild-realm">Realm</Label>
          <Input id="guild-realm" value={realm} maxLength={60} disabled={pending} onChange={(e) => setRealm(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guild-faction">Faction</Label>
          <select
            id="guild-faction"
            value={faction}
            disabled={pending}
            onChange={(e) => setFaction(e.target.value)}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          >
            <option value="Horde">Horde</option>
            <option value="Alliance">Alliance</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || pending}
          onClick={() => {
            setResult(null);
            startTransition(async () => {
              const next = await setGuildIdentityAction({ name, realm, faction });
              setResult(next);
              if (next.ok) router.refresh();
            });
          }}
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
              setName(initialName);
              setRealm(initialRealm);
              setFaction(initialFaction);
              setResult(null);
            }}
          >
            Discard
          </Button>
        )}
        {result && (
          <p className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        The old values go into the guild&apos;s audit log. A rename changes what every past loot
        decision appears to have been made under, so &ldquo;it used to be called…&rdquo; has to stay
        answerable.
      </p>
    </div>
  );
}
