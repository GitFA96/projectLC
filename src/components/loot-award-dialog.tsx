"use client";

import * as React from "react";
import { CircleAlert, Loader2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ItemLink } from "@/components/item-link";
import { DangerButton } from "@/components/roster-actions";
import {
  addAwardAction,
  deleteAwardsAction,
  updateAwardAction,
  type LootActionResult,
} from "@/app/loot/actions";
import type { Quality, WowClass } from "@/lib/types";
import { lookupItemAction } from "@/app/loot/actions";

export interface AwardDialogTarget {
  mode: "add" | "edit";
  raidSessionId: string;
  sessionLabel: string;
  /** Present in edit mode — the award being changed. */
  award?: {
    id: string;
    itemId: number;
    itemName: string;
    winnerName: string;
    winnerCharacterId?: string;
    external: boolean;
    offspec: boolean;
    note?: string;
  };
}

export interface DialogItem {
  id: number;
  /** Absent until some import or the Wowhead resolver learns it. */
  name?: string;
  quality?: Quality;
  icon?: string;
}

const CUSTOM = "__name__";
const EXTERNAL = "__external__";

export function LootAwardDialog({
  target,
  roster,
  onClose,
}: {
  target: AwardDialogTarget;
  roster: { id: string; name: string; wowClass: WowClass }[];
  onClose: () => void;
}) {
  const a = target.award;

  const [itemIdText, setItemIdText] = React.useState(a ? String(a.itemId) : "");
  const [itemName, setItemName] = React.useState(a?.itemName ?? "");
  const [winnerValue, setWinnerValue] = React.useState<string>(
    a ? (a.winnerCharacterId ? `chr:${a.winnerCharacterId}` : a.external ? EXTERNAL : CUSTOM) : CUSTOM,
  );
  const [winnerName, setWinnerName] = React.useState(
    a && (a.external || !a.winnerCharacterId) ? a.winnerName : "",
  );
  const [offspec, setOffspec] = React.useState(a?.offspec ?? false);
  const [note, setNote] = React.useState(a?.note ?? "");
  const [error, setError] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();

  const itemId = Number(itemIdText);
  const validItemId = Number.isInteger(itemId) && itemId > 0;

  /**
   * The typed item's cache entry, fetched per id rather than handed to us as
   * the entire item cache.
   *
   * The id it belongs to is stored with it, and the preview below only trusts
   * a result whose id still matches the box. That covers both an emptied field
   * and a slow lookup for an id the officer has already typed past — neither
   * can leave the wrong item on screen.
   */
  const [lookup, setLookup] = React.useState<{ id: number; item?: DialogItem }>();
  React.useEffect(() => {
    if (!validItemId) return;
    let cancelled = false;
    lookupItemAction(itemId).then((found) => {
      if (!cancelled) setLookup({ id: itemId, item: found ?? undefined });
    });
    return () => {
      cancelled = true;
    };
  }, [itemId, validItemId]);

  const known = validItemId && lookup?.id === itemId ? lookup.item : undefined;
  const winnerNeedsText = winnerValue === CUSTOM || winnerValue === EXTERNAL;
  const canSubmit = validItemId && (!winnerNeedsText || winnerName.trim().length > 0) && !pending;

  const winnerPayload = () => {
    if (winnerValue.startsWith("chr:")) return { kind: "character" as const, characterId: winnerValue.slice(4) };
    if (winnerValue === EXTERNAL) return { kind: "external" as const, rawWinnerName: winnerName.trim() };
    return { kind: "name" as const, rawWinnerName: winnerName.trim() };
  };

  const finish = (result: LootActionResult) => {
    if (result.ok) onClose();
    else setError(result.message);
  };

  const submit = () => {
    setError(undefined);
    const fields = {
      itemId,
      itemName: itemName.trim() || undefined,
      offspec,
      note: note.trim() || undefined,
      winner: winnerPayload(),
    };
    startTransition(async () => {
      finish(
        target.mode === "add"
          ? await addAwardAction({ ...fields, raidSessionId: target.raidSessionId })
          : await updateAwardAction({ ...fields, awardId: a!.id }),
      );
    });
  };

  const remove = () => {
    setError(undefined);
    startTransition(async () => finish(await deleteAwardsAction({ awardIds: [a!.id] })));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={target.mode === "add" ? "Add award" : "Edit award"}
      description={`${target.sessionLabel} raid`}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Item ID</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={itemIdText}
            onChange={(e) => setItemIdText(e.target.value)}
            placeholder="e.g. 28830"
            className="h-8"
            autoFocus
          />
          <div className="min-h-5 text-xs">
            {known ? (
              <ItemLink item={{ itemId: known.id, name: known.name, quality: known.quality, icon: known.icon }} size="sm" />
            ) : validItemId ? (
              <span className="text-muted-foreground">Not in the item cache — give it a name below.</span>
            ) : itemIdText ? (
              <span className="text-warn-ink">Item id must be a positive number.</span>
            ) : null}
          </div>
        </div>

        {validItemId && !known && (
          <div className="space-y-1">
            <Label className="text-xs">Item name</Label>
            <Input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Name shown until the item is cached"
              className="h-8"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-xs">Winner</Label>
          <Select value={winnerValue} onValueChange={setWinnerValue}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CUSTOM}>Custom name (pug / not yet on roster)</SelectItem>
              <SelectItem value={EXTERNAL}>Off-roster (disenchant / bank)</SelectItem>
              <SelectGroup>
                <SelectLabel>Roster</SelectLabel>
                {roster.map((c) => (
                  <SelectItem key={c.id} value={`chr:${c.id}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {winnerNeedsText && (
            <Input
              value={winnerName}
              onChange={(e) => setWinnerName(e.target.value)}
              placeholder={winnerValue === EXTERNAL ? "e.g. _disenchanted, Guild bank" : "Character name"}
              className="mt-1 h-8"
            />
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={offspec} onChange={(e) => setOffspec(e.target.checked)} />
          Off-spec award
        </label>

        <div className="space-y-1">
          <Label className="text-xs">Note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Council note…"
            className="min-h-16 text-sm"
          />
        </div>

        {error && (
          <p className="flex items-start gap-1.5 rounded-md border border-danger-line bg-danger-soft p-2 text-xs text-danger-ink">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button onClick={submit} disabled={!canSubmit}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {target.mode === "add" ? "Add award" : "Save changes"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {target.mode === "edit" && (
            <span className="ml-auto">
              <DangerButton disabled={pending} confirmLabel="Delete — confirm" onConfirm={remove}>
                <span className="inline-flex items-center gap-1">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </span>
              </DangerButton>
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
