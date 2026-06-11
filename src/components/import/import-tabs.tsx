"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FileUp, Loader2, MoveRight } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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
import { ItemLink, type ItemRef } from "@/components/item-link";
import { parseSixtyUpgradesExport } from "@/lib/import/sixtyupgrades";
import { parseGargulExport } from "@/lib/import/gargul";
import { diffGearSetSlots } from "@/lib/import/diff";
import { PHASES, SLOT_LABELS, type Phase, type Quality } from "@/lib/constants/wow";
import {
  commitGargul,
  commitSixtyUpgrades,
  type GargulCommitActionResult,
  type SixtyCommitResult,
} from "@/app/admin/import/actions";

const SU_EXAMPLE = JSON.stringify(
  {
    name: "P2 wishlist",
    character: { name: "Thrainn", class: "Warrior", spec: "Protection" },
    stats: { health: 14350, stamina: 920, defenseRating: 401, dodgeRating: 268 },
    slots: [
      { slot: "head", itemId: 30243, itemName: "Helm of the Vanquished Defender" },
      { slot: "trinket2", itemId: 30446, itemName: "Solarian's Sapphire" },
      { slot: "mainHand", itemId: 28749, itemName: "King's Defender", enchant: { name: "Mongoose" } },
    ],
  },
  null,
  2,
);

const GARGUL_EXAMPLE = [
  "2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0",
  "2026-06-04;22:56;30724;Serpent Spine Longbow;Sylvaria;0",
  "2026-06-04;21:48;30627;Tsunami Talisman;Shivven;0",
  "2026-06-04;22:57;30247;Leggings of the Vanquished Hero;Morgrave;1",
  "2026-06-04;22:58;30095;Fang of the Leviathan;Pugmage;0",
].join("\n");

export interface ImportPrefill {
  tab?: string;
  character?: string;
  kind?: string;
  phase?: string;
}

/** Item cache rows shipped from the server so previews resolve icon/quality live. */
export interface KnownItem {
  id: number;
  name: string;
  quality: Quality;
  icon: string;
}

interface ItemResolver {
  resolve: (itemId: number, fallbackName?: string) => ItemRef;
  isKnown: (itemId: number) => boolean;
}

function makeItemResolver(items: KnownItem[]): ItemResolver {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    resolve: (itemId, fallbackName) => {
      const cached = byId.get(itemId);
      return {
        itemId,
        name: cached?.name ?? fallbackName,
        quality: cached?.quality,
        icon: cached?.icon,
      };
    },
    isKnown: (itemId) => byId.has(itemId),
  };
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{message}</p>;
}

function CommitButton({ pending, onClick, disabled, children }: {
  pending: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button onClick={onClick} disabled={disabled || pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}

/* SixtyUpgrades */

function SixtyUpgradesTab({
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
            placeholder='{"name":"P2 wishlist","slots":[…]}'
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
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                {target} already has {kind === "wishlist" ? `a P${phase} wishlist` : "current gear"}:{" "}
                “{result.existing.name}” ({result.existing.slotCount} slots, imported{" "}
                {result.existing.importedAt.slice(0, 10)})
              </p>
              {confirmDiff.length === 0 ? (
                <p className="text-xs text-amber-700">
                  The new import has identical items — replacing only updates the stats and import date.
                </p>
              ) : (
                <div className="space-y-1 text-xs text-amber-800">
                  <p>Replacing changes {confirmDiff.length} slot{confirmDiff.length === 1 ? "" : "s"}:</p>
                  <ul className="space-y-0.5">
                    {confirmDiff.map((row) => (
                      <li key={row.label} className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{row.label}:</span>
                        <span className="text-amber-700/80">{row.before.join(" + ") || "—"}</span>
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
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
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
                <CircleCheck className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">{preview.parsed.setName ?? "Unnamed set"}</span>
                {preview.parsed.character?.name && (
                  <span className="text-muted-foreground">
                    detected character: {preview.parsed.character.name}
                  </span>
                )}
                <Badge variant="secondary">→ {target}, {targetLabel}</Badge>
              </p>
              <Warnings
                warnings={[
                  ...preview.parsed.warnings,
                  ...preview.parsed.slots
                    .filter((s) => !items.isKnown(s.itemId))
                    .map(
                      (s) =>
                        `Slot ${s.slot}: item ${s.itemId} (“${s.itemName}”) is not in the item cache — icon/quality unknown until backfilled.`,
                    ),
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

function GargulTab({
  characters,
  zones,
  items,
}: {
  characters: string[];
  zones: string[];
  items: ItemResolver;
}) {
  const [text, setText] = React.useState("");
  const [date, setDate] = React.useState("");
  const [selectedZones, setSelectedZones] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [preview, setPreview] = React.useState<ReturnType<typeof parseGargulExport> | null>(null);
  const [result, setResult] = React.useState<GargulCommitActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const rosterLower = React.useMemo(() => new Set(characters.map((n) => n.toLowerCase())), [characters]);
  const unresolved = preview?.lines.filter((l) => !rosterLower.has(l.rawWinnerName.toLowerCase())) ?? [];
  const unknownItems = preview?.lines.filter((l) => !items.isKnown(l.itemId)) ?? [];

  const commit = () => {
    startTransition(async () => {
      const res = await commitGargul({
        text,
        date,
        zones: selectedZones,
        note: note || undefined,
      });
      setResult(res);
      if (res.status === "committed" && res.inserted > 0) {
        setText("");
        setPreview(null);
      }
    });
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Gargul award export</CardTitle>
          <p className="text-xs text-muted-foreground">
            In Gargul: Award history → Export. Recommended custom format:{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              @DATE;@TIME;@ID;@ITEM;@WINNER;@OS
            </code>{" "}
            — semicolon, comma or tab separated all work, and item links (@LINK) are understood too.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setResult(null);
            }}
            placeholder="2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0"
            className="min-h-44 font-mono text-xs"
          />
          <Button variant="ghost" size="sm" onClick={() => setText(GARGUL_EXAMPLE)}>
            Insert example
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Raid date</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setResult(null);
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Progress night…"
                className="h-8"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Zones raided</Label>
            <div className="flex flex-wrap gap-1.5">
              {zones.map((zone) => {
                const active = selectedZones.includes(zone);
                return (
                  <button
                    key={zone}
                    type="button"
                    onClick={() => {
                      setSelectedZones((prev) =>
                        active ? prev.filter((z) => z !== zone) : [...prev, zone],
                      );
                      setResult(null);
                    }}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-foreground/30 bg-primary text-primary-foreground"
                        : "hover:bg-accent"
                    }`}
                  >
                    {zone}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setPreview(parseGargulExport(text, { fallbackDate: date || undefined }))}
              disabled={!text.trim()}
            >
              Preview
            </Button>
            <CommitButton
              pending={pending}
              onClick={commit}
              disabled={!text.trim() || !date || selectedZones.length === 0}
            >
              Commit import
            </CommitButton>
          </div>
          {(!date || selectedZones.length === 0) && text.trim() !== "" && (
            <p className="text-[11px] text-muted-foreground">
              Set the raid date and pick the zone(s) to enable committing.
            </p>
          )}

          {result?.status === "error" && <ErrorPanel message={result.message} />}

          {result?.status === "committed" && (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              {result.inserted > 0 ? (
                <>
                  <p className="flex items-center gap-1.5 font-medium">
                    <CircleCheck className="h-4 w-4" />
                    Raid session created — {result.inserted} award{result.inserted === 1 ? "" : "s"} recorded
                    {result.skippedDuplicates > 0 &&
                      `, ${result.skippedDuplicates} already-known award(s) skipped`}
                  </p>
                  {result.unresolved.length > 0 && (
                    <p className="text-xs text-amber-700">
                      Unresolved winners (kept by name, no roster match):{" "}
                      {result.unresolved.join(", ")} — add them as characters and re-link in a later
                      milestone, or fix the roster and re-import.
                    </p>
                  )}
                  {result.itemsCached > 0 && (
                    <p className="text-xs">
                      {result.itemsCached} new item(s) learned from item links and cached.
                    </p>
                  )}
                  <Warnings warnings={result.warnings} />
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/loot?session=${encodeURIComponent(result.sessionId ?? "")}`}>
                      View this session in the loot ledger
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="flex items-center gap-1.5">
                  <CircleAlert className="h-4 w-4 text-amber-600" />
                  All {result.skippedDuplicates} award(s) in the paste were already recorded — nothing
                  imported, no session created.
                </p>
              )}
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
          {preview && (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <CircleCheck className="h-4 w-4 text-emerald-600" />
                {preview.lines.length} awards parsed
                {unresolved.length > 0 && (
                  <Badge variant="warning">{unresolved.length} unresolved winner(s)</Badge>
                )}
                {unknownItems.length > 0 && (
                  <Badge variant="warning">{unknownItems.length} item(s) not in cache</Badge>
                )}
              </p>
              <Warnings warnings={preview.warnings} />
              {preview.lines.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">When</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Winner</TableHead>
                      <TableHead className="w-20">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.lines.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {row.awardedAt.replace("T", " ").slice(0, 16)}
                        </TableCell>
                        <TableCell>
                          <ItemLink item={items.resolve(row.itemId, row.itemName)} />
                        </TableCell>
                        <TableCell>
                          {rosterLower.has(row.rawWinnerName.toLowerCase()) ? (
                            <span className="text-sm font-medium">{row.rawWinnerName}</span>
                          ) : (
                            <Badge variant="warning" title="No roster character with this name">
                              {row.rawWinnerName} ?
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.offspec ? (
                            <Badge variant="warning">OS</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">MS</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="text-[11px] text-muted-foreground">
                Already-recorded awards are skipped at commit time; wishlist matching always runs live
                against each winner&apos;s imported wishlists.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ImportTabs({
  characters,
  zones,
  knownItems,
  prefill = {},
}: {
  characters: string[];
  zones: string[];
  knownItems: KnownItem[];
  prefill?: ImportPrefill;
}) {
  const items = React.useMemo(() => makeItemResolver(knownItems), [knownItems]);
  return (
    <Tabs defaultValue={prefill.tab === "gargul" ? "gargul" : "sixtyupgrades"}>
      <TabsList>
        <TabsTrigger value="sixtyupgrades">SixtyUpgrades sets</TabsTrigger>
        <TabsTrigger value="gargul">Gargul loot</TabsTrigger>
      </TabsList>
      <TabsContent value="sixtyupgrades">
        <SixtyUpgradesTab characters={characters} prefill={prefill} items={items} />
      </TabsContent>
      <TabsContent value="gargul">
        <GargulTab characters={characters} zones={zones} items={items} />
      </TabsContent>
    </Tabs>
  );
}
