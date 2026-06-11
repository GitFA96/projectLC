"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, FileUp } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemLink } from "@/components/item-link";
import { slotItemSchema } from "@/lib/import/schemas";
import { isKnownItem, resolveItemRef } from "@/lib/client-item-cache";
import { PHASES, SLOT_LABELS } from "@/lib/constants/wow";
import type { SlotItem } from "@/lib/types";

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

function DisabledCommit() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button disabled>Commit import</Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Preview only — persistence ships in Milestone 2.</TooltipContent>
    </Tooltip>
  );
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

/* SixtyUpgrades */

interface SuPreview {
  setName?: string;
  characterName?: string;
  slots: SlotItem[];
  stats: [string, number][];
  warnings: string[];
}

function parseSixtyUpgrades(text: string): SuPreview | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "Not valid JSON — paste the raw SixtyUpgrades set export." };
  }
  if (typeof json !== "object" || json === null || !Array.isArray((json as { slots?: unknown }).slots)) {
    return { error: "JSON has no `slots` array — is this a SixtyUpgrades set export?" };
  }
  const raw = json as { name?: string; character?: { name?: string }; slots: unknown[]; stats?: unknown };
  const warnings: string[] = [];
  const slots: SlotItem[] = [];
  raw.slots.forEach((slot, i) => {
    const parsed = slotItemSchema.safeParse(slot);
    if (parsed.success) {
      slots.push(parsed.data);
      if (!isKnownItem(parsed.data.itemId)) {
        warnings.push(`Slot ${parsed.data.slot}: item ${parsed.data.itemId} (“${parsed.data.itemName}”) is not in the item cache — icon/quality unknown until backfilled.`);
      }
    } else {
      warnings.push(`Slot entry ${i + 1} skipped: ${parsed.error.issues[0]?.message ?? "invalid shape"}.`);
    }
  });
  const stats: [string, number][] = [];
  if (raw.stats && typeof raw.stats === "object") {
    for (const [key, value] of Object.entries(raw.stats)) {
      if (typeof value === "number") stats.push([key, value]);
      else warnings.push(`Stat “${key}” ignored (not a number).`);
    }
  }
  if (slots.length === 0) return { error: "No valid slot entries found." };
  return { setName: raw.name, characterName: raw.character?.name, slots, stats, warnings };
}

function SixtyUpgradesTab({ characters }: { characters: string[] }) {
  const [text, setText] = React.useState("");
  const [target, setTarget] = React.useState<string>(characters[0] ?? "");
  const [kind, setKind] = React.useState("wishlist");
  const [phase, setPhase] = React.useState("2");
  const [preview, setPreview] = React.useState<SuPreview | { error: string } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>SixtyUpgrades set export</CardTitle>
          <p className="text-xs text-muted-foreground">
            In SixtyUpgrades: open the set → Export → JSON. Paste it here or upload the file. One set
            marked “current” per character; wishlists are per phase.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
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
            <Button variant="ghost" size="sm" onClick={() => setText(SU_EXAMPLE)}>
              Insert example
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Character</Label>
              <Select value={target} onValueChange={setTarget}>
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
              <Select value={kind} onValueChange={setKind}>
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
                <Select value={phase} onValueChange={setPhase}>
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
            <Button variant="secondary" onClick={() => setPreview(parseSixtyUpgrades(text))} disabled={!text.trim()}>
              Preview
            </Button>
            <DisabledCommit />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!preview && <p className="text-sm text-muted-foreground">Paste an export and hit Preview.</p>}
          {preview && "error" in preview && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{preview.error}</p>
          )}
          {preview && !("error" in preview) && (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <CircleCheck className="h-4 w-4 text-emerald-600" />
                <span className="font-medium">{preview.setName ?? "Unnamed set"}</span>
                {preview.characterName && (
                  <span className="text-muted-foreground">detected character: {preview.characterName}</span>
                )}
                <Badge variant="secondary">
                  → {target}, {kind === "wishlist" ? `P${phase} wishlist` : "current gear"}
                </Badge>
              </p>
              <Warnings warnings={preview.warnings} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Slot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Enchant / gems</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slots.map((s) => (
                    <TableRow key={`${s.slot}-${s.itemId}`}>
                      <TableCell className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {SLOT_LABELS[s.slot]}
                      </TableCell>
                      <TableCell>
                        <ItemLink item={resolveItemRef(s.itemId, s.itemName)} />
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
              {preview.stats.length > 0 && (
                <p className="flex flex-wrap gap-1.5">
                  {preview.stats.slice(0, 10).map(([k, v]) => (
                    <Badge key={k} variant="muted" className="tabular-nums">
                      {k}: {v}
                    </Badge>
                  ))}
                  {preview.stats.length > 10 && (
                    <Badge variant="muted">+{preview.stats.length - 10} more</Badge>
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

interface GargulRow {
  awardedAt: string;
  itemId: number;
  itemName: string;
  winner: string;
  matched: boolean;
  offspec: boolean;
  knownItem: boolean;
}

function parseGargul(text: string, rosterNames: string[]): { rows: GargulRow[]; warnings: string[] } {
  const lower = new Set(rosterNames.map((n) => n.toLowerCase()));
  const rows: GargulRow[] = [];
  const warnings: string[] = [];
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const delimiter = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const cols = line.split(delimiter).map((c) => c.trim());
    let date: string, time: string, idRaw: string, itemName: string, winner: string, osRaw: string;
    if (cols.length >= 6) {
      [date, time, idRaw, itemName, winner, osRaw] = cols;
    } else if (cols.length === 5) {
      [date, idRaw, itemName, winner, osRaw] = cols;
      time = "00:00";
    } else {
      warnings.push(`Line ${i + 1} skipped — expected 5-6 columns, got ${cols.length}.`);
      continue;
    }
    const itemId = Number(idRaw);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      warnings.push(`Line ${i + 1} skipped — “${idRaw}” is not an item ID.`);
      continue;
    }
    rows.push({
      awardedAt: `${date} ${time}`.trim(),
      itemId,
      itemName,
      winner,
      matched: lower.has(winner.toLowerCase()),
      offspec: osRaw === "1" || /^(os|offspec|yes|true)$/i.test(osRaw ?? ""),
      knownItem: isKnownItem(itemId),
    });
  }
  return { rows, warnings };
}

function GargulTab({ characters, zones }: { characters: string[]; zones: string[] }) {
  const [text, setText] = React.useState("");
  const [date, setDate] = React.useState("");
  const [selectedZones, setSelectedZones] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [preview, setPreview] = React.useState<ReturnType<typeof parseGargul> | null>(null);

  const unresolved = preview?.rows.filter((r) => !r.matched) ?? [];
  const unknownItems = preview?.rows.filter((r) => !r.knownItem) ?? [];

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
            — semicolon, comma or tab separated all work.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0"
            className="min-h-44 font-mono text-xs"
          />
          <Button variant="ghost" size="sm" onClick={() => setText(GARGUL_EXAMPLE)}>
            Insert example
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Raid date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8" />
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
                    onClick={() =>
                      setSelectedZones((prev) =>
                        active ? prev.filter((z) => z !== zone) : [...prev, zone],
                      )
                    }
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
              onClick={() => setPreview(parseGargul(text, characters))}
              disabled={!text.trim()}
            >
              Preview
            </Button>
            <DisabledCommit />
          </div>
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
                {preview.rows.length} awards parsed
                {unresolved.length > 0 && (
                  <Badge variant="warning">{unresolved.length} unresolved winner(s)</Badge>
                )}
                {unknownItems.length > 0 && (
                  <Badge variant="warning">{unknownItems.length} item(s) not in cache</Badge>
                )}
              </p>
              <Warnings warnings={preview.warnings} />
              {preview.rows.length > 0 && (
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
                    {preview.rows.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {row.awardedAt}
                        </TableCell>
                        <TableCell>
                          <ItemLink item={resolveItemRef(row.itemId, row.itemName)} />
                        </TableCell>
                        <TableCell>
                          {row.matched ? (
                            <span className="text-sm font-medium">{row.winner}</span>
                          ) : (
                            <Badge variant="warning" title="No roster character with this name">
                              {row.winner} ?
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
                Wishlist matching runs at commit time against each winner&apos;s imported wishlists.
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
}: {
  characters: string[];
  zones: string[];
}) {
  return (
    <Tabs defaultValue="sixtyupgrades">
      <TabsList>
        <TabsTrigger value="sixtyupgrades">SixtyUpgrades sets</TabsTrigger>
        <TabsTrigger value="gargul">Gargul loot</TabsTrigger>
      </TabsList>
      <TabsContent value="sixtyupgrades">
        <SixtyUpgradesTab characters={characters} />
      </TabsContent>
      <TabsContent value="gargul">
        <GargulTab characters={characters} zones={zones} />
      </TabsContent>
    </Tabs>
  );
}
