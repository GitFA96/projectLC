"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ItemLink } from "@/components/item-link";
import { parseGargulExport } from "@/lib/import/gargul";
import { commitGargul, type GargulCommitActionResult } from "@/app/guild/import/actions";
import {
  CommitButton,
  ErrorPanel,
  Warnings,
  type ItemResolver,
} from "@/components/import/import-shared";
const GARGUL_EXAMPLE = [
  "2026-06-04;22:55;30243;Helm of the Vanquished Defender;Thrainn;0",
  "2026-06-04;22:56;30724;Serpent Spine Longbow;Sylvaria;0",
  "2026-06-04;21:48;30627;Tsunami Talisman;Shivven;0",
  "2026-06-04;22:57;30247;Leggings of the Vanquished Hero;Morgrave;1",
  "2026-06-04;22:58;30095;Fang of the Leviathan;Pugmage;0",
].join("\n");

export function GargulTab({
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
            <div className="space-y-2 rounded-md border border-success-line bg-success-soft p-3 text-sm text-success-ink">
              {result.inserted > 0 ? (
                <>
                  <p className="flex items-center gap-1.5 font-medium">
                    <CircleCheck className="h-4 w-4" />
                    Raid session created — {result.inserted} award{result.inserted === 1 ? "" : "s"} recorded
                    {result.skippedDuplicates > 0 &&
                      `, ${result.skippedDuplicates} already-known award(s) skipped`}
                  </p>
                  {result.unresolved.length > 0 && (
                    <p className="text-xs text-warn-ink">
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
                  <CircleAlert className="h-4 w-4 text-warn-ink" />
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
                <CircleCheck className="h-4 w-4 text-success-ink" />
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
