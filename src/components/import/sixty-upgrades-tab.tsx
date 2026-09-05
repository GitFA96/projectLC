"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FileUp, MoveRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemLink } from "@/components/item-link";
import { parseSixtyUpgradesExport } from "@/lib/import/sixtyupgrades";
import { diffGearSetSlots } from "@/lib/import/diff";
import { PHASES, SLOT_LABELS, type Phase } from "@/lib/constants/wow";
import { commitSixtyUpgrades, type SixtyCommitResult } from "@/app/guild/import/actions";
import {
  CommitButton,
  ErrorPanel,
  Warnings,
  type ImportPrefill,
  type ItemResolver,
} from "@/components/import/import-shared";
/** Mirrors the real SixtyUpgrades export shape (see src/lib/import/__fixtures__). */
const SU_EXAMPLE = JSON.stringify(
  {
    name: "P2 wishlist",
    phase: 2,
    character: { name: "Thrainn", level: 70, gameClass: "WARRIOR", race: "ORC", faction: "HORDE" },
    items: [
      { name: "Helm of the Vanquished Defender", id: 30243, slot: "HEAD" },
      { name: "Solarian's Sapphire", id: 30446, slot: "TRINKET_2" },
      {
        name: "King's Defender",
        id: 28749,
        enchant: { name: "Enchant Weapon - Mongoose", id: 2673 },
        slot: "MAIN_HAND",
      },
    ],
    stats: { health: 14350, stamina: 920, defense: 401, dodgeRating: 268 },
  },
  null,
  2,
);

export function SixtyUpgradesTab({
  characters,
  prefill,
  items,
}: {
  characters: string[];
  prefill: ImportPrefill;
  items: ItemResolver;
}) {
  const prefillCharacter =
    characters.find((c) => c.toLowerCase() === prefill.character?.toLowerCase()) ?? characters[0] ?? "";
  const [text, setText] = React.useState("");
  const [target, setTarget] = React.useState<string>(prefillCharacter);
  const [kind, setKind] = React.useState(prefill.kind === "current" ? "current" : "wishlist");
  const [phase, setPhase] = React.useState(
    prefill.phase && PHASES.some((p) => String(p.phase) === prefill.phase) ? prefill.phase : "2",
  );
  const [preview, setPreview] = React.useState<ReturnType<typeof parseSixtyUpgradesExport> | null>(null);
  const [result, setResult] = React.useState<SixtyCommitResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Any input change invalidates a pending confirm/result panel.
  const update = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setResult(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setResult(null);
  };

  const commit = (confirmReplace: boolean) => {
    startTransition(async () => {
      const res = await commitSixtyUpgrades({
        json: text,
        characterName: target,
        kind: kind as "current" | "wishlist",
        phase: kind === "wishlist" ? (Number(phase) as Phase) : undefined,
        confirmReplace,
      });
      setResult(res);
      if (res.status === "committed") {
        setText("");
        setPreview(null);
      }
    });
  };

  const newParse = React.useMemo(
    () => (text.trim() ? parseSixtyUpgradesExport(text) : null),
    [text],
  );
  const confirmDiff =
    result?.status === "needs-confirm" && newParse?.ok
      ? diffGearSetSlots(result.existing.slots, newParse.parsed.slots)
      : [];

  const targetLabel = kind === "wishlist" ? `P${phase} wishlist` : "current gear";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>SixtyUpgrades set export</CardTitle>
          <p className="text-xs text-muted-foreground">
            In SixtyUpgrades: open the set → Export → JSON. Paste it here or upload the file. One set
            marked “current” per character; wishlists are per phase. Re-importing updates the existing
            set after you confirm the changes.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder='{"name":"P2 wishlist","phase":2,"items":[…],"stats":{…}}'
            className="min-h-44 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent">
              <FileUp className="h-4 w-4" /> Upload .json
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <Button variant="ghost" size="sm" onClick={() => update(setText)(SU_EXAMPLE)}>
              Insert example
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Character</Label>
              <Select value={target} onValueChange={update(setTarget)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {characters.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Import as</Label>
              <Select value={kind} onValueChange={update(setKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current gear</SelectItem>
                  <SelectItem value="wishlist">Phase wishlist</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {kind === "wishlist" && (
              <div className="space-y-1">
                <Label className="text-xs">Phase</Label>
                <Select value={phase} onValueChange={update(setPhase)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHASES.map((p) => (
                      <SelectItem key={p.phase} value={String(p.phase)}>
                        {p.short} — {p.zones.join(", ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {kind === "wishlist" &&
            newParse?.ok &&
            newParse.parsed.phase !== undefined &&
            String(newParse.parsed.phase) !== phase && (
              <p className="flex flex-wrap items-center gap-2 rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
                <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                The pasted export is built for P{newParse.parsed.phase}, not P{phase}.
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => update(setPhase)(String(newParse.parsed.phase))}
                >
                  Import as P{newParse.parsed.phase}
                </Button>
              </p>
            )}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setPreview(parseSixtyUpgradesExport(text))}
              disabled={!text.trim()}
            >
              Preview
            </Button>
            <CommitButton pending={pending} onClick={() => commit(false)} disabled={!text.trim() || !target}>
              Commit import
            </CommitButton>
          </div>

          {result?.status === "error" && <ErrorPanel message={result.message} />}

          {result?.status === "needs-confirm" && (
            <div className="space-y-2 rounded-md border border-warn-line bg-warn-soft p-3">
              <p className="text-sm font-medium text-warn-ink">
                {target} already has {kind === "wishlist" ? `a P${phase} wishlist` : "current gear"}:{" "}
                “{result.existing.name}” ({result.existing.slotCount} slots, imported{" "}
                {result.existing.importedAt.slice(0, 10)})
              </p>
              {confirmDiff.length === 0 ? (
                <p className="text-xs text-warn-ink">
                  The new import has identical items — replacing only updates the stats and import date.
                </p>
              ) : (
                <div className="space-y-1 text-xs text-warn-ink">
                  <p>Replacing changes {confirmDiff.length} slot{confirmDiff.length === 1 ? "" : "s"}:</p>
                  <ul className="space-y-0.5">
                    {confirmDiff.map((row) => (
                      <li key={row.label} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{row.label}:</span>
                        <span className="text-warn-ink/80">{row.before.join(" + ") || "—"}</span>
                        <MoveRight className="h-3 w-3 shrink-0" />
                        <span>{row.after.join(" + ") || "—"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <CommitButton pending={pending} onClick={() => commit(true)}>
                  Replace {kind === "wishlist" ? `P${phase} wishlist` : "current gear"}
                </CommitButton>
                <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {result?.status === "committed" && (
            <div className="space-y-2 rounded-md border border-success-line bg-success-soft p-3 text-sm text-success-ink">
              <p className="flex items-center gap-1.5 font-medium">
                <CircleCheck className="h-4 w-4" />
                {result.replaced ? "Updated" : "Imported"} “{result.setName}” —{" "}
                {result.kind === "wishlist" ? `P${result.phase} wishlist` : "current gear"} for{" "}
                {result.characterName} ({result.slotCount} slots)
              </p>
              <Warnings warnings={result.warnings} />
              <Button asChild size="sm" variant="outline">
                <Link href={`/characters/${encodeURIComponent(result.characterName.toLowerCase())}`}>
                  View {result.characterName}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!preview && <p className="text-sm text-muted-foreground">Paste an export and hit Preview.</p>}
          {preview && !preview.ok && <ErrorPanel message={preview.error} />}
          {preview?.ok && (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <CircleCheck className="h-4 w-4 text-success-ink" />
                <span className="font-medium">{preview.parsed.setName ?? "Unnamed set"}</span>
                {preview.parsed.character?.name && (
                  <span className="text-muted-foreground">
                    {preview.parsed.character.name}
                    {preview.parsed.character.class && ` · ${preview.parsed.character.class}`}
                  </span>
                )}
                {preview.parsed.phase !== undefined && (
                  <Badge variant="muted">built for P{preview.parsed.phase}</Badge>
                )}
                <Badge variant="secondary">→ {target}, {targetLabel}</Badge>
              </p>
              <Warnings
                warnings={[
                  ...preview.parsed.warnings,
                  ...(() => {
                    const unknown = preview.parsed.slots.filter((s) => !items.isKnown(s.itemId));
                    return unknown.length > 0
                      ? [
                          `${unknown.length} item(s) aren't in the local item cache yet — they'll render with the export's name but without icon/quality until backfilled.`,
                        ]
                      : [];
                  })(),
                ]}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Slot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Enchant / gems</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.parsed.slots.map((s) => (
                    <TableRow key={`${s.slot}-${s.itemId}`}>
                      <TableCell className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {SLOT_LABELS[s.slot]}
                      </TableCell>
                      <TableCell>
                        <ItemLink item={items.resolve(s.itemId, s.itemName)} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[s.enchant?.name, s.gems && s.gems.length > 0 ? `${s.gems.length} gem(s)` : undefined]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {Object.keys(preview.parsed.stats).length > 0 && (
                <p className="flex flex-wrap gap-1.5">
                  {Object.entries(preview.parsed.stats).slice(0, 10).map(([k, v]) => (
                    <Badge key={k} variant="muted" className="tabular-nums">
                      {k}: {v}
                    </Badge>
                  ))}
                  {Object.keys(preview.parsed.stats).length > 10 && (
                    <Badge variant="muted">+{Object.keys(preview.parsed.stats).length - 10} more</Badge>
                  )}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* Gargul */
