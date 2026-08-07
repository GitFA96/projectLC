"use client";

import * as React from "react";
import { Loader2, Search, Wand2 } from "lucide-react";
import {
  clearCurrentSlotsAction,
  equipLoggedGearAction,
  setCurrentSlotAction,
} from "@/app/characters/[name]/current-gear-actions";
import { rankItemMatches, type QuickSearchItem } from "@/lib/analysis/quick-search";
import { ItemIcon } from "@/components/item-icon";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { QUALITY_TEXT_COLORS, SLOT_FAMILIES, SLOT_META } from "@/lib/constants/wow";
import type { CurrentSlotOptionView } from "@/components/current-slot-picker";
import type { GearSpec, Quality, SlotId } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Current gear, slot by slot, from either source the app has.
 *
 * The imported SixtyUpgrades set is one snapshot of intent and the logs are
 * ground truth for the nights they cover — but neither answers "they won this
 * on an unlogged alt run three weeks ago". So each slot can be set from what
 * they were logged wearing OR from anything the item database already knows,
 * and either way it's the same pin: an officer's statement about one slot,
 * overriding the import, cleared with one click.
 *
 * Searching is scoped to the slot being filled. An item whose slot the cache
 * knows can only be offered for that slot (rings and trinkets share their
 * pair); one whose slot nobody has recorded is offered everywhere, because
 * hiding it would be worse than showing it in the wrong place.
 *
 * The same editor serves both kits. An off-spec kit has no import behind it —
 * nobody exports the set they only wear when the guild is short a tank — so
 * it's pins all the way down, and the copy says so rather than offering to
 * "go back to the imported set" that isn't there.
 */

export interface GearSlotRow {
  slot: SlotId;
  /** What's recorded in the slot right now — a pin, or the import's answer. */
  current?: ItemRef;
  /** True when `current` is a pin rather than the imported set's own answer. */
  pinned: boolean;
  /** The imported set's item for this slot, when it has one. */
  imported?: ItemRef;
  /** Items logged in this slot (or its pair) over the recent raid nights. */
  logged: CurrentSlotOptionView[];
}

const familyKey = (slot: SlotId): string => SLOT_FAMILIES[slot] ?? slot;

/** Items the cache says belong in this slot, plus any whose slot is unknown. */
function candidatesFor(items: QuickSearchItem[], slot: SlotId): QuickSearchItem[] {
  const family = familyKey(slot);
  return items.filter((i) => !i.slot || familyKey(i.slot) === family);
}

function ItemRow({
  item,
  detail,
  onPick,
  disabled,
}: {
  item: { itemId: number; name?: string; quality?: Quality; icon?: string };
  detail?: string;
  onPick: () => void;
  disabled?: boolean;
}) {
  const quality = item.quality ?? "common";
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <ItemIcon icon={item.icon} quality={quality} size={20} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium" style={{ color: QUALITY_TEXT_COLORS[quality] }}>
          {item.name ?? `Item #${item.itemId}`}
        </span>
        {detail && <span className="truncate text-[11px] text-muted-foreground">{detail}</span>}
      </span>
    </button>
  );
}

function SlotDialog({
  characterName,
  row,
  label,
  items,
  spec,
  specLabel,
  onClose,
}: {
  characterName: string;
  row: GearSlotRow;
  label: string;
  items: QuickSearchItem[];
  spec: GearSpec;
  /** "Protection off-spec", for the copy that has to name the kit. */
  specLabel?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const pool = React.useMemo(() => candidatesFor(items, row.slot), [items, row.slot]);
  const results = React.useMemo(() => rankItemMatches(pool, query, 12), [pool, query]);

  const pick = (itemId: number | null, source: "logs" | "manual") => {
    setError(null);
    startTransition(async () => {
      const result = await setCurrentSlotAction({
        characterName,
        slot: row.slot,
        itemId,
        source,
        spec,
      });
      if (result.ok) onClose();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={specLabel ? `${label} — ${characterName}, ${specLabel}` : `${label} — ${characterName}`}
      description={
        spec === "off"
          ? "Pick what they field in this slot when they play the off-spec. Kept apart from their main-spec gear."
          : "Pick what they actually have. This overrides the imported set for this slot only."
      }
      className="max-w-lg"
    >
      <div className="space-y-3">
        {row.logged.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {spec === "off" ? "Worn on their recent off-spec pulls" : "Worn in their recent raids"}
            </p>
            <div className="max-h-44 overflow-y-auto rounded-md border">
              {row.logged.map((option) => (
                <ItemRow
                  key={option.itemId}
                  item={option}
                  detail={`${option.detail}${option.fromPairedSlot ? " · other slot" : ""}`}
                  disabled={pending}
                  onPick={() => pick(option.itemId, "logs")}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Search the item database
          </p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label.toLowerCase()} items…`}
              className="h-8 pl-7"
              autoFocus
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="mt-1 max-h-56 overflow-y-auto rounded-md border">
              {results.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Nothing in the database matches — items arrive from imports, loot pastes and logs.
                </p>
              ) : (
                results.map((item) => (
                  <ItemRow
                    key={item.itemId}
                    item={item}
                    detail={item.slot ? undefined : "slot unknown"}
                    disabled={pending}
                    onPick={() => pick(item.itemId, "manual")}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {error && <p className="text-xs text-danger-ink">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            {spec === "off" ? (
              "Off-spec gear is recorded on its own — it never changes their main-spec set."
            ) : row.imported ? (
              <>
                Imported set says <span className="font-medium">{row.imported.name}</span>
              </>
            ) : (
              "The imported set has nothing here."
            )}
          </span>
          <span className="flex items-center gap-2">
            {row.pinned && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => pick(null, "logs")}>
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {row.imported ? "Back to imported" : "Clear slot"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Fill every slot at once from the last raids logged.
 *
 * Arm-then-confirm, because it overwrites: it's a sync from the logs, not a
 * merge, and a slot someone set by hand is worth one deliberate second click.
 */
function EquipFromLogsButton({
  characterName,
  loggedSlots,
  spec,
  specLabel,
}: {
  characterName: string;
  loggedSlots: number;
  spec: GearSpec;
  specLabel?: string;
}) {
  const [armed, setArmed] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (loggedSlots === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {spec === "off"
          ? `${characterName} hasn't been logged playing ${specLabel ?? "their off-spec"} yet — fill these slots from the item database instead.`
          : `Nothing logged for ${characterName} yet — import a Warcraft Logs report to fill gear from it.`}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        variant={armed ? "default" : "outline"}
        size="sm"
        className="h-7 gap-1 px-2.5 text-xs"
        disabled={pending}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          setResult(null);
          startTransition(async () => {
            setResult(
              await equipLoggedGearAction({ characterNames: [characterName], replace: true, spec }),
            );
          });
        }}
        title={
          spec === "off"
            ? "Set every slot to whatever they last wore while playing this spec"
            : "Set every slot to whatever they were last logged wearing"
        }
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        {armed
          ? `Overwrite ${loggedSlots} slots — confirm`
          : spec === "off"
            ? "Equip latest off-spec gear from logs"
            : "Equip latest from logs"}
      </Button>
      <span className={cn("text-xs", result ? (result.ok ? "text-success-ink" : "text-warn-ink") : "text-muted-foreground")}>
        {result?.message ??
          `${loggedSlots} slot${loggedSlots === 1 ? "" : "s"} readable from their recent ${spec === "off" ? "off-spec pulls" : "raids"} — this replaces anything set by hand.`}
      </span>
    </span>
  );
}

export function CurrentGearEditor({
  characterName,
  rows,
  items,
  pinnedCount,
  spec = "main",
  offSpec,
}: {
  characterName: string;
  rows: GearSlotRow[];
  /** The local item database, for the per-slot search. */
  items: QuickSearchItem[];
  pinnedCount: number;
  /** Which kit this editor edits. */
  spec?: GearSpec;
  /** The recorded off-spec's name — required when `spec` is "off". */
  offSpec?: string;
}) {
  const [editing, setEditing] = React.useState<SlotId | null>(null);
  const [resetting, startReset] = React.useTransition();
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  const open = editing ? bySlot.get(editing) : undefined;
  // Slots the logs can answer: the button's reach, stated before it's pressed.
  const loggedSlots = rows.filter((r) => r.logged.some((o) => o.latest)).length;
  const isOff = spec === "off";
  const specLabel = offSpec ? `${offSpec} off-spec` : undefined;

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>{isOff ? `Off-spec gear — ${offSpec}` : "Current gear"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {isOff ? (
            <>
              What they field when they step in as {offSpec}. Kept entirely apart from their
              main-spec set — loot is still judged on the main spec, so nothing here moves them on a
              priority list.
            </>
          ) : (
            <>
              What they actually have, slot by slot. Each slot starts from the imported set; setting
              one by hand — from their logged gear or from the item database — overrides just that
              slot and counts everywhere loot is judged.
            </>
          )}
        </p>
        <EquipFromLogsButton
          characterName={characterName}
          loggedSlots={loggedSlots}
          spec={spec}
          specLabel={specLabel}
        />
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y rounded-md border">
          {SLOT_META.map(({ id, label }) => {
            const row = bySlot.get(id);
            return (
              <li key={id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {label}
                </span>
                <span className="min-w-0 flex-1">
                  {row?.current ? (
                    <ItemLink
                      item={row.current}
                      size="sm"
                      className={cn(!row.pinned && "opacity-70")}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground/50">—</span>
                  )}
                </span>
                {row?.pinned && (
                  <Badge
                    variant="secondary"
                    className="shrink-0 px-1 py-0 text-[10px] font-normal"
                    title={isOff ? "Set by hand" : "Set by hand — overrides the imported set"}
                  >
                    set
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-xs"
                  onClick={() => setEditing(id)}
                >
                  {row?.current ? "Change" : "Set"}
                </Button>
              </li>
            );
          })}
        </ul>

        {pinnedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {pinnedCount} slot{pinnedCount === 1 ? "" : "s"} set by hand ·{" "}
            <button
              type="button"
              disabled={resetting}
              onClick={() =>
                startReset(async () => void (await clearCurrentSlotsAction(characterName, spec)))
              }
              className="cursor-pointer font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50"
            >
              {resetting ? "Clearing…" : isOff ? "clear the whole off-spec set" : "reset all to the imported set"}
            </button>
          </p>
        )}
      </CardContent>

      {open && (
        <SlotDialog
          characterName={characterName}
          row={open}
          label={SLOT_META.find((s) => s.id === open.slot)!.label}
          items={items}
          spec={spec}
          specLabel={specLabel}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
