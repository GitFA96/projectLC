"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LootAwardDialog, type AwardDialogTarget } from "@/components/loot-award-dialog";
import type { WowClass } from "@/lib/types";

/**
 * Edit one recorded award from outside the ledger — the same dialog, the same
 * write, so a correction made on a character's own loot history is the
 * correction an officer would have made on `/loot`.
 *
 * The winner picker is the ledger's, so an edit can hand the item to somebody
 * else entirely; the row then leaves whichever page it was edited from. That's
 * the point — a mis-attributed award is the common reason to open this.
 */
export function AwardEditButton({
  target,
  roster,
  canAmend = false,
  label = "Edit",
}: {
  target: AwardDialogTarget;
  roster: { id: string; name: string; wowClass: WowClass }[];
  /** `loot.amend` — whether the date is editable here. See LootAwardDialog. */
  canAmend?: boolean;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" /> {label}
      </Button>
      {open && (
        <LootAwardDialog
          target={target}
          roster={roster}
          canAmend={canAmend}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
