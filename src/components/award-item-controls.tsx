"use client";

import * as React from "react";
import { Gift, Loader2, Undo2 } from "lucide-react";
import {
  awardItemAction,
  clearAwardAction,
  type AwardItemInput,
} from "@/app/characters/[name]/award-actions";
import { ItemLink, type ItemRef } from "@/components/item-link";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Handing an item to a character by hand — from a wishlist row, from the loot
 * history for anything not on a list, or from the item itself. Writes a normal
 * loot award, so everything derived from loot (wishlist status, fairness,
 * contention) follows without a second source of truth.
 *
 * The winner is either decided by where the button sits (a wishlist row knows
 * whose it is) or chosen in the dialog. The second case is not a convenience:
 * an item's page lists the people who *wanted* it, and the awards that go
 * missing are precisely the ones that went to somebody who didn't — a drop
 * Gargul never saw, or a piece won in another raid. A picker that only offered
 * the contenders would be unable to record exactly those.
 */

export interface AwardSessionOption {
  id: string;
  label: string;
}

/** One possible winner, when the dialog is the thing that picks. */
export interface AwardCandidate {
  id: string;
  name: string;
}

export interface AwardContext {
  characterId: string;
  characterName: string;
  /** Recent raid nights an award can be filed under, newest first. */
  sessions: AwardSessionOption[];
  /** Raid zones offered when creating a manual entry. */
  zones: string[];
  defaultZone: string;
  /** Today, ISO — the default date for a new manual entry. */
  today: string;
}

const NEW_SESSION = "__new__";

function AwardDialog({
  ctx,
  prefill,
  candidates,
  onClose,
}: {
  ctx: AwardContext;
  prefill?: ItemRef;
  /** When given, the winner is chosen here instead of fixed by the caller. */
  candidates?: AwardCandidate[];
  onClose: () => void;
}) {
  const [characterId, setCharacterId] = React.useState(ctx.characterId);
  const [itemIdText, setItemIdText] = React.useState(prefill ? String(prefill.itemId) : "");
  const [itemName, setItemName] = React.useState(prefill?.name ?? "");
  const [sessionValue, setSessionValue] = React.useState(ctx.sessions[0]?.id ?? NEW_SESSION);
  const [date, setDate] = React.useState(ctx.today);
  const [zone, setZone] = React.useState(ctx.defaultZone);
  const [offspec, setOffspec] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const itemId = Number(itemIdText);
  const validItem = Number.isInteger(itemId) && itemId > 0;
  const creatingSession = sessionValue === NEW_SESSION;

  const submit = () => {
    if (!characterId) {
      setError("Pick who won it.");
      return;
    }
    if (!validItem) {
      setError("Enter the item's id — the number in its Wowhead link.");
      return;
    }
    const input: AwardItemInput = {
      characterId,
      itemId,
      itemName: itemName.trim() || undefined,
      offspec,
      note: note.trim() || undefined,
      target: creatingSession ? { kind: "new", date, zone } : { kind: "session", sessionId: sessionValue },
    };
    startTransition(async () => {
      const result = await awardItemAction(input);
      if (result.ok) onClose();
      else setError(result.message);
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={candidates ? "Award this item" : `Award an item to ${ctx.characterName}`}
      description="Records a normal loot award — it shows up in the ledger, the wishlist status and the fairness counts."
    >
      <div className="space-y-3">
        {prefill && (
          <div className="rounded-md border bg-muted/40 p-2">
            <ItemLink item={prefill} />
          </div>
        )}

        {candidates && (
          <div>
            <Label>Winner</Label>
            <Select value={characterId} onValueChange={(v) => { setCharacterId(v); setError(null); }}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue placeholder="Pick a raider" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-[7rem_1fr] gap-2">
          <div>
            <Label htmlFor="award-item-id">Item id</Label>
            <Input
              id="award-item-id"
              value={itemIdText}
              onChange={(e) => {
                setItemIdText(e.target.value.replace(/[^\d]/g, ""));
                setError(null);
              }}
              inputMode="numeric"
              placeholder="30048"
              className="mt-1 tabular-nums"
            />
          </div>
          <div>
            <Label htmlFor="award-item-name">Name (optional)</Label>
            <Input
              id="award-item-name"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="looked up if left blank"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label>Raid night</Label>
          <Select value={sessionValue} onValueChange={setSessionValue}>
            <SelectTrigger className="mt-1 w-full">
              <SelectValue placeholder="Pick a raid" />
            </SelectTrigger>
            <SelectContent>
              {ctx.sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
              <SelectItem value={NEW_SESSION}>+ New manual entry…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {creatingSession && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="award-date">Date</Label>
              <Input
                id="award-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Raid</Label>
              <Select value={zone} onValueChange={setZone}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue placeholder="Pick a raid" />
                </SelectTrigger>
                <SelectContent>
                  {ctx.zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={offspec} onChange={(e) => setOffspec(e.target.checked)} />
          Off-spec award
        </label>

        <div>
          <Label htmlFor="award-note">Note (optional)</Label>
          <Textarea
            id="award-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="traded after the raid, missed in the paste…"
            className="mt-1"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={pending || !validItem || !characterId}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {pending ? "Awarding…" : "Award item"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Opens the award dialog, optionally prefilled with a wishlist row's item. */
export function AwardItemButton({
  ctx,
  prefill,
  label = "Award",
  variant = "outline",
  className,
}: {
  ctx: AwardContext;
  prefill?: ItemRef;
  label?: string;
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={cn("h-7 gap-1 px-2 text-xs", className)}
        onClick={() => setOpen(true)}
      >
        <Gift className="h-3.5 w-3.5" />
        {label}
      </Button>
      {open && <AwardDialog ctx={ctx} prefill={prefill} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Award this item to anyone on the roster.
 *
 * The counterpart to `AwardItemButton`: same dialog, same write, but the
 * winner is chosen rather than implied. Lives where an officer is looking at
 * one item and needs to record that it went to somebody the app doesn't
 * already associate with it.
 */
export function AwardToAnyoneButton({
  target,
  candidates,
  prefill,
  label = "Award to…",
  variant = "outline",
  className,
}: {
  /** Everything about the award except who won it. */
  target: Omit<AwardContext, "characterId" | "characterName">;
  candidates: AwardCandidate[];
  prefill?: ItemRef;
  label?: string;
  variant?: "outline" | "default" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={cn("h-7 gap-1 px-2 text-xs", className)}
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        title={
          candidates.length === 0
            ? "No characters on the roster yet"
            : "Record this item going to any raider — including someone who never wishlisted it"
        }
      >
        <Gift className="h-3.5 w-3.5" />
        {label}
      </Button>
      {open && (
        <AwardDialog
          ctx={{ ...target, characterId: "", characterName: "" }}
          candidates={candidates}
          prefill={prefill}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Removes an award — one click to arm, a second to confirm. */
export function ClearAwardButton({ awardId }: { awardId: string }) {
  const [armed, setArmed] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      variant={armed ? "destructive" : "ghost"}
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      disabled={pending}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        startTransition(async () => {
          await clearAwardAction({ awardId });
        });
      }}
      title="Remove this award — the slot goes back to open"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
      {armed ? "Remove?" : "Clear"}
    </Button>
  );
}
