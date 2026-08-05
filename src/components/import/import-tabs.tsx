"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, FileUp, Loader2, MoveRight, Pencil } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  deleteWclReportAction,
  deleteWclReportsAction,
  refetchWclReport,
  updateWclReportMetaAction,
  importWclReport,
  type WclImportActionResult,
} from "@/app/admin/import/wcl-actions";
import { parseReportCodes } from "@/lib/wcl/report-codes";
import { ActionResultLine, DangerButton, useRosterAction } from "@/components/roster-actions";

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

/**
   * Item cache rows shipped from the server so previews resolve icon/quality
   * live. Every field but the id is optional — the cache fills in from
   * whatever each import knew, so a row can be a name with no icon yet.
   */
export interface KnownItem {
  id: number;
  name?: string;
  quality?: Quality;
  icon?: string;
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

/** ms into the report → "1:23:45" / "23:45". */
function fmtOffset(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
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
              <p className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
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
            In Gargul: Award history → Export. The standard CSV export (it leads with a{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              dateTime,character,itemID,offspec,id
            </code>{" "}
            header) works pasted as-is — the header is detected and the award id ignored. A custom
            format like{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              @DATE;@TIME;@ID;@ITEM;@WINNER;@OS
            </code>{" "}
            works too — semicolon, comma or tab separated, and item links (@LINK) are understood.
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

/* Warcraft Logs */

export interface SessionOption {
  id: string;
  label: string;
}

export interface ImportedReport {
  code: string;
  title: string;
  zone?: string;
  /** ISO report start — shown as the raid date. */
  startTime: string;
  /**
   * ISO timestamp of the last fetch. Re-importing replaces a report wholesale,
   * so this is "as of when do we know this", which is what tells an officer
   * whether a report predates newly-added tracking and needs re-importing.
   */
  fetchedAt: string;
  playerCount: number;
  encounterCount: number;
  killCount: number;
  sessionLabel?: string;
}

/** One report in a bulk import, as the queue works through it. */
interface QueueItem {
  code: string;
  state: "waiting" | "running" | "done";
  result?: WclImportActionResult;
}

/**
 * Live progress for a sequence of report fetches — one line per report, in
 * order. Shared by the bulk import and the refetch button so both read the
 * same way; `verb` is the only thing that differs.
 */
function ImportQueue({ items, verb = "Imported" }: { items: QueueItem[]; verb?: string }) {
  const done = items.filter((i) => i.state === "done");
  const failed = done.filter((i) => i.result?.status !== "committed");
  const running = items.some((i) => i.state !== "done");
  const gerund = verb === "Imported" ? "Importing" : "Refetching";

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium">
        {running
          ? `${gerund} ${done.length + 1} of ${items.length}…`
          : `${verb} ${done.length - failed.length} of ${items.length}`}
        {failed.length > 0 && !running && ` — ${failed.length} failed`}
      </p>
      <ul className="space-y-1 text-xs">
        {items.map((item) => {
          const ok = item.result?.status === "committed";
          return (
            <li key={item.code} className="flex items-baseline gap-2">
              <span
                className={
                  item.state === "waiting"
                    ? "text-muted-foreground"
                    : item.state === "running"
                      ? "text-foreground"
                      : ok
                        ? "text-emerald-700"
                        : "text-red-700"
                }
              >
                {item.state === "waiting" ? "·" : item.state === "running" ? "…" : ok ? "✓" : "✕"}
              </span>
              <span className="font-mono text-muted-foreground">{item.code}</span>
              <span className="min-w-0 flex-1">
                {item.state === "done" && item.result?.status === "committed" && (
                  <>
                    {item.result.replaced ? "updated" : "imported"} — {item.result.title}
                    {` (${item.result.fightCount} pull${item.result.fightCount === 1 ? "" : "s"})`}
                  </>
                )}
                {item.state === "done" && item.result?.status === "error" && (
                  <span className="text-red-700">{item.result.message}</span>
                )}
                {item.state === "done" && item.result?.status === "not-configured" && (
                  <span className="text-red-700">Warcraft Logs credentials are not configured.</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {!running && (
        <p className="text-xs text-muted-foreground">
          Reports keep the titles Warcraft Logs gave them — rename any of them in the list below.
        </p>
      )}
    </div>
  );
}

/** Failed entries in a finished run, with why. */
function failedItems(items: QueueItem[]) {
  return items.filter((i) => i.state === "done" && i.result?.status !== "committed");
}

/**
 * One-line refetch progress, sitting beside the button that started it.
 *
 * A refetch is a bulk operation on rows that are already on screen, so the
 * per-report list the import flow shows would just duplicate the table below
 * it. What's actually useful mid-run is "is it still going, and where is it" —
 * one line, naming only the report currently in flight.
 */
function RefetchStatus({ items }: { items: QueueItem[] }) {
  const done = items.filter((i) => i.state === "done").length;
  const current = items.find((i) => i.state === "running") ?? items.find((i) => i.state === "waiting");
  const failed = failedItems(items).length;

  if (current) {
    return (
      <span className="min-w-0 text-xs font-normal text-muted-foreground">
        Refetching {Math.min(done + 1, items.length)} of {items.length}
        <span className="ml-1.5 font-mono">{current.code}</span>
      </span>
    );
  }
  if (failed > 0) {
    return (
      <span className="text-xs font-normal text-red-700">
        Refetched {items.length - failed} of {items.length} — {failed} failed
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs font-normal text-emerald-700">
      <CircleCheck className="h-3.5 w-3.5" />
      Refetched {items.length} report{items.length === 1 ? "" : "s"}
    </span>
  );
}

/**
 * The detail for anything that failed, at the foot of the card.
 *
 * Only rendered when there's something wrong: a successful run says so in one
 * line up top and needs no further reading. A failure needs the code and the
 * reason, because the fix is usually per-report.
 */
function RefetchFailures({ items }: { items: QueueItem[] }) {
  const failed = failedItems(items);
  if (failed.length === 0 || items.some((i) => i.state !== "done")) return null;
  return (
    <div className="space-y-1 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
      <p className="font-medium">
        {failed.length} report{failed.length === 1 ? "" : "s"} could not be refetched — everything
        else was updated.
      </p>
      <ul className="space-y-0.5">
        {failed.map((item) => (
          <li key={item.code} className="flex flex-wrap items-baseline gap-1.5">
            <span className="font-mono">{item.code}</span>
            <span>
              {item.result?.status === "error"
                ? item.result.message
                : item.result?.status === "not-configured"
                  ? "Warcraft Logs credentials are not configured."
                  : "Unknown error."}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One report row: title/zone with an inline rename editor. */
function ImportedReportRow({
  r,
  pending,
  run,
  selected,
  onToggle,
  onRefetch,
  busy,
}: {
  r: ImportedReport;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; message: string }>) => void;
  selected: boolean;
  onToggle: () => void;
  onRefetch: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(r.title);
  const [zone, setZone] = React.useState(r.zone ?? "");

  const save = () => {
    run(() => updateWclReportMetaAction({ code: r.code, title: title.trim(), zone: zone.trim() }));
    setEditing(false);
  };

  return (
    <TableRow>
      <TableCell>
        <Checkbox checked={selected} onChange={onToggle} aria-label={`Select ${r.title}`} />
      </TableCell>
      <TableCell className="tabular-nums text-muted-foreground">{r.startTime.slice(0, 10)}</TableCell>
      <TableCell>
        {editing ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-7 w-44 text-xs"
              placeholder="Report name"
              aria-label="Report name"
            />
            <Input
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="h-7 w-32 text-xs"
              placeholder="Raid label (e.g. SSC/TK)"
              aria-label="Raid label"
            />
            <Button size="sm" className="h-7" disabled={pending || !title.trim()} onClick={save}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => {
                setEditing(false);
                setTitle(r.title);
                setZone(r.zone ?? "");
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <span className="text-sm font-medium">{r.title}</span>
            {r.zone && <span className="ml-2 text-xs text-muted-foreground">{r.zone}</span>}
            <span className="ml-2 font-mono text-[11px] text-muted-foreground/60">{r.code}</span>
            <button
              type="button"
              aria-label={`Rename ${r.title}`}
              title="Rename report / relabel raid"
              className="ml-1.5 cursor-pointer align-middle text-muted-foreground hover:text-foreground"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </>
        )}
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">
        {r.encounterCount} ({r.killCount})
      </TableCell>
      <TableCell className="text-right text-sm tabular-nums">{r.playerCount}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{r.sessionLabel ?? "—"}</TableCell>
      <TableCell
        className="text-xs tabular-nums text-muted-foreground"
        // Absolute rather than "3 days ago": this renders on the server and
        // hydrates on the client, and a relative label computed twice can
        // disagree. The exact moment is one hover away.
        title={r.fetchedAt}
      >
        {r.fetchedAt.slice(0, 10)}
      </TableCell>
      <TableCell className="text-right">
        <DangerButton
          disabled={pending}
          confirmLabel="Confirm remove"
          onConfirm={() => run(() => deleteWclReportAction({ code: r.code }))}
        >
          Remove
        </DangerButton>
      </TableCell>
      <TableCell className="text-right">
        {/* Outlined, not ghost: a bare label in a table reads as text, and the
            one control that re-runs a network fetch should look clickable. */}
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onRefetch}>
          Refetch
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ImportedReportsCard({ reports }: { reports: ImportedReport[] }) {
  const { pending, result, run } = useRosterAction();
  const [picked, setPicked] = React.useState<string[]>([]);

  /*
   * Derive the live selection rather than pruning it in an effect: after a
   * delete the removed codes simply stop matching, so a stale code can never
   * be handed to a later "delete selected". Syncing this with setState in an
   * effect would be an extra render and a lint error for the same result.
   */
  const live = React.useMemo(() => new Set(reports.map((r) => r.code)), [reports]);
  const selected = React.useMemo(() => picked.filter((c) => live.has(c)), [picked, live]);
  const setSelected = setPicked;

  const allSelected = reports.length > 0 && selected.length === reports.length;
  const toggle = (code: string) =>
    setSelected((s) => (s.includes(code) ? s.filter((c) => c !== code) : [...s, code]));

  const [queue, setQueue] = React.useState<QueueItem[] | null>(null);
  const [refetching, startRefetch] = React.useTransition();

  /**
   * Re-fetch one or many, sequentially — same reasoning as the bulk import:
   * each report is several API calls, and a failure partway through must keep
   * everything already done. One row uses the same path as ten so there's only
   * one behaviour to reason about.
   */
  const refetch = (codes: string[]) => {
    if (codes.length === 0) return;
    setQueue(codes.map((code) => ({ code, state: "waiting" })));
    startRefetch(async () => {
      for (let i = 0; i < codes.length; i++) {
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "running" } : it)));
        const res = await refetchWclReport({ code: codes[i] });
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "done", result: res } : it)));
      }
    });
  };
  const busy = pending || refetching;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span>Imported reports</span>
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {queue && <RefetchStatus items={queue} />}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || reports.length === 0}
              onClick={() => refetch(selected.length > 0 ? selected : reports.map((r) => r.code))}
            >
              {refetching && <Loader2 className="h-4 w-4 animate-spin" />}
              {selected.length > 0 ? `Refetch ${selected.length} selected` : "Refetch all"}
            </Button>
            {selected.length > 0 && (
              <DangerButton
                disabled={busy}
                confirmLabel={`Delete ${selected.length}`}
                onConfirm={() => {
                  const codes = selected;
                  setSelected([]);
                  return run(() => deleteWclReportsAction({ codes }));
                }}
              >
                Remove {selected.length} selected
              </DangerButton>
            )}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          <strong>Refetch</strong> pulls a report again from Warcraft Logs, keeping its name, raid
          label and linked session — that&apos;s how an older import gains anything the app has
          learned to track since. Removing one deletes its pulls,
          parses and consumable data — attendance recounts immediately. The same report can always
          be imported again.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {reports.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No reports imported yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : reports.map((r) => r.code))}
                    aria-label="Select all reports"
                  />
                </TableHead>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Report</TableHead>
                <TableHead className="text-right">Bosses (kills)</TableHead>
                <TableHead className="text-right">Players</TableHead>
                <TableHead>Linked session</TableHead>
                <TableHead className="w-28" title="When this report was last fetched from Warcraft Logs">
                  Imported
                </TableHead>
                <TableHead className="w-36"></TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => (
                <ImportedReportRow
                  key={r.code}
                  r={r}
                  pending={pending}
                  run={run}
                  selected={selected.includes(r.code)}
                  onToggle={() => toggle(r.code)}
                  onRefetch={() => refetch([r.code])}
                  busy={busy}
                />
              ))}
            </TableBody>
          </Table>
        )}
        {queue && <RefetchFailures items={queue} />}
        <ActionResultLine result={result} />
      </CardContent>
    </Card>
  );
}

function WclTab({
  sessions,
  configured,
  reports,
}: {
  sessions: SessionOption[];
  configured: boolean;
  reports: ImportedReport[];
}) {
  const [report, setReport] = React.useState("");
  const [sessionId, setSessionId] = React.useState("none");
  const [titleOverride, setTitleOverride] = React.useState("");
  const [zoneOverride, setZoneOverride] = React.useState("");
  const [result, setResult] = React.useState<WclImportActionResult | null>(null);
  const [queue, setQueue] = React.useState<QueueItem[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  const parsed = React.useMemo(() => parseReportCodes(report), [report]);
  const many = parsed.codes.length > 1;

  const commit = () => {
    setResult(null);
    setQueue(null);
    startTransition(async () => {
      if (!many) {
        setResult(
          await importWclReport({
            report,
            raidSessionId: sessionId === "none" ? undefined : sessionId,
            title: titleOverride.trim() || undefined,
            zone: zoneOverride.trim() || undefined,
          }),
        );
        return;
      }
      /*
       * One report at a time, on purpose.
       *
       * Each import is ~7 API calls and takes seconds, so a batch of ten would
       * risk a server-action timeout and would hammer the rate limit in
       * parallel. Sequential also means a failure on the sixth report keeps the
       * five before it — and the officer can watch it progress instead of
       * staring at a spinner with no idea how far along it is.
       *
       * Overrides and session linking are deliberately not applied here: one
       * title for ten different raid nights would be wrong, and each report
       * keeps whatever WCL calls it (rename inline below afterwards).
       */
      const items: QueueItem[] = parsed.codes.map((code) => ({ code, state: "waiting" }));
      setQueue(items);
      for (let i = 0; i < items.length; i++) {
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "running" } : it)));
        const res = await importWclReport({ report: items[i].code });
        setQueue((q) => q && q.map((it, n) => (n === i ? { ...it, state: "done", result: res } : it)));
      }
    });
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Warcraft Logs report</CardTitle>
          <p className="text-xs text-muted-foreground">
            Paste a report URL (or just its code). The app fetches parses (all-damage, healing and
            boss-damage), per-pull consumable usage, deaths and the worn-gear snapshot via the
            official API — players are matched to the roster by name. Fetching the same report
            again replaces it (the update flow), which is also how an older import gains anything
            added since.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!configured ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Warcraft Logs API credentials aren&apos;t configured.</p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-amber-700">
                <li>
                  Create a (free) API client at{" "}
                  <a
                    href="https://www.warcraftlogs.com/api/clients"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    warcraftlogs.com/api/clients
                  </a>{" "}
                  — any name, no redirect URL needed.
                </li>
                <li>
                  Put the pair in <code className="rounded bg-amber-100 px-1 font-mono">.env.local</code>:{" "}
                  <code className="rounded bg-amber-100 px-1 font-mono">WCL_CLIENT_ID</code> and{" "}
                  <code className="rounded bg-amber-100 px-1 font-mono">WCL_CLIENT_SECRET</code>
                </li>
                <li>Restart the dev server and reload this page.</li>
              </ol>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Report URLs or codes</Label>
                <Textarea
                  value={report}
                  onChange={(e) => {
                    setReport(e.target.value);
                    setResult(null);
                    setQueue(null);
                  }}
                  rows={4}
                  placeholder={
                    "https://classic.warcraftlogs.com/reports/AbCdEf1234567890\n" +
                    "…paste as many as you like, one per line"
                  }
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {parsed.codes.length === 0
                    ? "One report or many — URLs and bare codes, in any order."
                    : `${parsed.codes.length} report${parsed.codes.length === 1 ? "" : "s"} found`}
                  {parsed.duplicates > 0 && `, ${parsed.duplicates} duplicate skipped`}
                  {parsed.invalid.length > 0 && (
                    <span className="text-amber-700">
                      {" "}
                      · ignored: {parsed.invalid.slice(0, 3).join(", ")}
                      {parsed.invalid.length > 3 && ` +${parsed.invalid.length - 3} more`}
                    </span>
                  )}
                </p>
              </div>
              {many && (
                <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                  Importing {parsed.codes.length} reports one after another — each keeps its own
                  Warcraft Logs title, and no raid session is linked. Import a single report on its
                  own if you want to set those.
                </p>
              )}
              <div className={many ? "hidden" : "grid gap-3 sm:grid-cols-2"}>
                <div className="space-y-1">
                  <Label className="text-xs">Report name (optional)</Label>
                  <Input
                    value={titleOverride}
                    onChange={(e) => setTitleOverride(e.target.value)}
                    placeholder="Keep WCL's title"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Raid label (optional)</Label>
                  <Input
                    value={zoneOverride}
                    onChange={(e) => setZoneOverride(e.target.value)}
                    placeholder="e.g. SSC/TK — WCL often mislabels multi-zone nights"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div className={many ? "hidden" : "space-y-1"}>
                <Label className="text-xs">Link to raid session (optional)</Label>
                <Select value={sessionId} onValueChange={setSessionId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CommitButton pending={pending} onClick={commit} disabled={parsed.codes.length === 0}>
                {many ? `Fetch & import ${parsed.codes.length} reports` : "Fetch & import"}
              </CommitButton>
            </>
          )}

          {queue && <ImportQueue items={queue} />}

          {result?.status === "not-configured" && (
            <ErrorPanel message="Warcraft Logs credentials are not configured — reload the page for setup instructions." />
          )}
          {result?.status === "error" && <ErrorPanel message={result.message} />}
          {result?.status === "committed" && (
            <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <p className="flex items-center gap-1.5 font-medium">
                <CircleCheck className="h-4 w-4" />
                {result.replaced ? "Updated" : "Imported"} “{result.title}”
                {result.zone && ` — ${result.zone}`} ({result.fightCount} boss pull
                {result.fightCount === 1 ? "" : "s"})
              </p>
              <p className="text-xs">
                {result.matched.length} raider(s) matched to tracked characters
                {result.unmatched.length > 0 && (
                  <>
                    {" "}
                    · untracked: {result.unmatched.join(", ")} — add them as puggers on the{" "}
                    <Link href="/roster" className="font-medium underline-offset-2 hover:underline">
                      roster page
                    </Link>
                  </>
                )}
              </p>
              <Warnings warnings={result.warnings} />
              {result.ignored.total > 0 && (
                <details className="rounded-md border border-emerald-200/60 bg-white/50 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Inspect the {result.ignored.total} ignored combatant-info event(s) (
                    {result.ignored.players} player{result.ignored.players === 1 ? "" : "s"})
                  </summary>
                  <p className="mt-1.5 text-muted-foreground">
                    WCL fires one combatant-info per player for <em>every</em> combat segment —
                    trash included. Only boss pulls feed parses, consumables and attendance, so
                    these were skipped. Sample (first {result.ignored.sample.length}):
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {result.ignored.sample.map((e, i) => (
                      <li key={i} className="tabular-nums">
                        <span className="font-medium">{e.player}</span>
                        <span className="text-muted-foreground"> at {fmtOffset(e.atMs)}</span>
                        <span className="text-muted-foreground">
                          {" — "}
                          {e.auras.length > 0
                            ? `consumables up: ${e.auras.join(", ")}`
                            : "no consumables visible"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-muted-foreground">
                    If a whole boss kill seems missing instead, check the report on Warcraft Logs —
                    a broken/split log segment looks exactly like this.
                  </p>
                </details>
              )}
              {result.auraDump.length > 0 && (
                <details className="rounded-md border border-emerald-200/60 bg-white/50 p-2 text-xs">
                  <summary className="cursor-pointer font-medium">
                    Consumable-tuning dump: {result.auraDump.length} unrecognized aura name(s) at pulls
                  </summary>
                  <p className="mt-1.5 text-muted-foreground">
                    Auras seen at boss pulls that the consumable tables don&apos;t classify. Known
                    class buffs (blessings, auras, shouts, stances…) are already filtered out, so
                    what&apos;s left is genuinely unknown. If a consumable is missing from
                    someone&apos;s tracking, it&apos;s in this list: copy the block and paste it
                    into development to tune the tables.
                  </p>
                  <pre className="mt-1.5 max-h-56 select-all overflow-y-auto whitespace-pre-wrap rounded bg-muted/60 p-2 font-mono text-[11px] leading-4">
                    {result.auraDump
                      .map((a) => `${String(a.abilityId ?? "?").padStart(6)}  ${a.name}  ×${a.count}`)
                      .join("\n")}
                  </pre>
                </details>
              )}
              {result.matched.length > 0 && (
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/characters/${encodeURIComponent(result.matched[0].toLowerCase())}/performance`}
                  >
                    View {result.matched[0]}&apos;s performance
                  </Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What gets imported</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            For every boss pull and every raider: <span className="text-foreground">parse percentile</span>{" "}
            (DPS, or HPS for healers) with its item-level bracket percentile,{" "}
            <span className="text-foreground">deaths</span>, and the full{" "}
            <span className="text-foreground">preparation picture</span> — flask/elixirs, food,
            weapon buff at the pull, pre-pots, and potions/drums/runes used during the fight.
          </p>
          <p>
            Gear seen at each pull is captured in full — every worn item with its quality, enchant
            and gems feeds the <span className="text-foreground">gear panel</span> on the
            performance page, where enchants are named and graded against imported wishlists
            (weapon enchant + temp buff get special attention).
          </p>
          <p>
            Per pull it also tracks the <span className="text-foreground">class toolkit</span>:
            major cooldown casts (Death Wish, Combustion, Innervate, Bloodlust…) with the moment
            each was pressed, shaman totem drops, and the uptime of maintained debuffs/buffs —
            warlock curse assignments, Thunder Clap, Demoralizing Shout, shouts, judgements,
            Faerie Fire, Earth Shield and friends. Raid buffs are also read back{" "}
            <span className="text-foreground">per recipient</span> on the logs page.
          </p>
          <p>
            Everything lands on each character&apos;s <span className="text-foreground">Performance</span>{" "}
            page (linked from their profile), per report and as a career rollup. Linking a report to
            a Gargul session ties the night&apos;s performance to its loot decisions.
          </p>
          <p className="text-xs">
            Costs ~7 API calls per report — the free Warcraft Logs tier allows thousands per hour.
          </p>
        </CardContent>
      </Card>

      <ImportedReportsCard reports={reports} />
    </div>
  );
}

export function ImportTabs({
  characters,
  zones,
  knownItems,
  sessions,
  wclConfigured,
  wclReports,
  prefill = {},
}: {
  characters: string[];
  zones: string[];
  knownItems: KnownItem[];
  sessions: SessionOption[];
  wclConfigured: boolean;
  wclReports: ImportedReport[];
  prefill?: ImportPrefill;
}) {
  const items = React.useMemo(() => makeItemResolver(knownItems), [knownItems]);
  const defaultTab =
    prefill.tab === "gargul" ? "gargul" : prefill.tab === "wcl" ? "wcl" : "sixtyupgrades";
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="sixtyupgrades">SixtyUpgrades sets</TabsTrigger>
        <TabsTrigger value="gargul">Gargul loot</TabsTrigger>
        <TabsTrigger value="wcl">Warcraft Logs</TabsTrigger>
      </TabsList>
      <TabsContent value="sixtyupgrades">
        <SixtyUpgradesTab characters={characters} prefill={prefill} items={items} />
      </TabsContent>
      <TabsContent value="gargul">
        <GargulTab characters={characters} zones={zones} items={items} />
      </TabsContent>
      <TabsContent value="wcl">
        <WclTab sessions={sessions} configured={wclConfigured} reports={wclReports} />
      </TabsContent>
    </Tabs>
  );
}
