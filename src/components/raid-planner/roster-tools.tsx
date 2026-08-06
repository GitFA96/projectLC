"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, UserPlus, X } from "lucide-react";
import {
  rosterBoardKey,
  type Prospect,
  type GuildRoster,
} from "@/lib/analysis/raid-planner";
import { CLASS_SPECS, CLASS_TEXT_COLORS, WOW_CLASSES, classTint } from "@/lib/constants/wow";
import type { WowClass } from "@/lib/types";
import {
  createGuildRoster,
  deleteGuildRoster,
  renameGuildRoster,
  setRosterProspects,
} from "@/app/raid-planner/actions";
import { SpecBadge } from "@/components/spec-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The controls that belong to a guild roster rather than to the board on it:
 * its name, its existence, and the people on it who don't exist yet.
 *
 * Separate from `RaidBoard` because they save separately. One meta row
 * holds all three parts of a board, and the board autosaves continuously
 * while these are deliberate, one-off edits — so each patches its own field and
 * leaves the others alone (see `updateGuildRoster`).
 */

const ROLES = [
  { value: "tank", label: "Tank" },
  { value: "healer", label: "Healer" },
  { value: "dps", label: "DPS" },
] as const;

export function NewRosterButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createGuildRoster();
          // Straight onto the new board: an officer who asked for a roster
          // wants to fill it in, not to hunt for the pill that just appeared.
          if (res.ok && res.id) router.push(`/raid-planner?board=${rosterBoardKey(res.id)}`);
        })
      }
      className={cn(
        "inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs transition-colors duration-75 hover:bg-accent disabled:opacity-50",
        className,
      )}
      title="Another roster — a split's second team, next week's Wednesday, a what-if"
    >
      <Plus className="h-3 w-3" aria-hidden /> Roster
    </button>
  );
}

export function RosterTools({
  board,
  /** Roster names, so a prospect the guild has since recruited can say so. */
  rosterNames,
}: {
  board: GuildRoster;
  rosterNames: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [name, setName] = React.useState(board.name);
  const [prospects, setProspects] = React.useState<Prospect[]>(board.prospects);
  const [msg, setMsg] = React.useState<string | null>(null);

  /* The board id changes under this component when the officer switches pills,
     and React keeps the state — so reset from props when it does. */
  const [rosterId, setBoardId] = React.useState(board.id);
  if (rosterId !== board.id) {
    setBoardId(board.id);
    setName(board.name);
    setProspects(board.prospects);
    setMsg(null);
  }

  const commitName = () => {
    const clean = name.trim();
    if (!clean || clean === board.name) {
      setName(board.name);
      return;
    }
    startTransition(async () => {
      const res = await renameGuildRoster(board.id, clean);
      if (!res.ok) setMsg(res.message);
      else router.refresh();
    });
  };

  const commitProspects = (next: Prospect[]) => {
    setProspects(next);
    startTransition(async () => {
      const res = await setRosterProspects(board.id, next);
      if (!res.ok) setMsg(res.message);
      else router.refresh();
    });
  };

  const remove = (target: string) =>
    commitProspects(prospects.filter((p) => p.name.toLowerCase() !== target.toLowerCase()));

  const onRoster = new Set(rosterNames.map((n) => n.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setName(board.name);
          }}
          maxLength={40}
          aria-label="Roster name"
          className="h-8 w-52 font-medium"
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-muted-foreground hover:text-destructive"
          disabled={pending}
          onClick={() => {
            /* A plan is not history — deleting one is allowed where deleting a
               raid night's record is not. Still a confirm: the groups go too. */
            if (!window.confirm(`Delete "${board.name}"? The groups on it go with it.`)) return;
            startTransition(async () => {
              const res = await deleteGuildRoster(board.id);
              if (res.ok) router.push("/raid-planner?board=guild");
              else setMsg(res.message);
            });
          }}
          title="Delete this roster"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete roster
        </Button>
        {msg && <span className="text-xs text-destructive">{msg}</span>}
      </div>

      <ProspectCard
        prospects={prospects}
        onAdd={(p) => commitProspects([...prospects, p])}
        onRemove={remove}
        onRoster={onRoster}
      />
    </div>
  );
}

/**
 * Invent a raider.
 *
 * The question this exists for is "would a second resto shaman fix group four",
 * asked before anyone has been recruited. Answering it by creating a character
 * would put somebody who has never raided into attendance, loot priority and
 * every other page that counts the roster — so these live on this board alone.
 */
function ProspectCard({
  prospects,
  onAdd,
  onRemove,
  onRoster,
}: {
  prospects: Prospect[];
  onAdd: (p: Prospect) => void;
  onRemove: (name: string) => void;
  onRoster: Set<string>;
}) {
  const [name, setName] = React.useState("");
  const [wowClass, setWowClass] = React.useState<WowClass | "">("");
  const [spec, setSpec] = React.useState("");
  const [role, setRole] = React.useState<"tank" | "healer" | "dps" | "">("");

  const taken = prospects.some((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  const canAdd = name.trim().length > 0 && !taken;

  const add = () => {
    if (!canAdd) return;
    onAdd({
      name: name.trim(),
      ...(wowClass ? { wowClass } : {}),
      ...(spec ? { spec } : {}),
      ...(role ? { role } : {}),
    });
    setName("");
    setSpec("");
    setRole("");
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
          Trials and recruits — people who aren&apos;t on the roster, so you can see what
          adding one would fix. They live on this roster only, and never become characters.
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Name"
            maxLength={60}
            aria-label="Trial's name"
            className="h-8 w-36"
          />
          {/* Native selects: three of them in a row, and a portalled popover
              each would be a lot of machinery for "which class". */}
          <select
            value={wowClass}
            onChange={(e) => {
              setWowClass(e.target.value as WowClass | "");
              setSpec("");
            }}
            aria-label="Trial's class"
            className="h-8 cursor-pointer rounded-md border border-input bg-card px-2 text-sm"
            style={{ color: wowClass ? CLASS_TEXT_COLORS[wowClass] : undefined }}
          >
            <option value="">Class…</option>
            {WOW_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            disabled={!wowClass}
            aria-label="Trial's spec"
            className="h-8 cursor-pointer rounded-md border border-input bg-card px-2 text-sm disabled:opacity-50"
          >
            <option value="">Spec…</option>
            {wowClass &&
              CLASS_SPECS[wowClass].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
          </select>
          {/* Asked, not inferred. What a spec does in this guild's raid is the
              guild's call — see AGENTS.md invariant 5. */}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            aria-label="What they'd do in the raid"
            className="h-8 cursor-pointer rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="">Role…</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <Button size="sm" className="h-8" onClick={add} disabled={!canAdd}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
          {taken && (
            <span className="text-xs text-muted-foreground">
              Already on this roster.
            </span>
          )}
        </div>

        {prospects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {prospects.map((p) => {
              const recruited = onRoster.has(p.name.toLowerCase());
              return (
                <span
                  key={p.name}
                  className={cn(
                    "group inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs",
                    recruited && "opacity-60",
                  )}
                  style={{ backgroundColor: classTint(p.wowClass) }}
                  title={
                    recruited
                      ? `${p.name} is on the roster now — they come from there, so this entry does nothing. Remove it.`
                      : `${p.name} — not on the roster`
                  }
                >
                  {/* Icon first, name second — the order every chip on the
                      bench uses. A trial that read the other way round would
                      be the one thing on the page scanning differently. */}
                  {p.spec && <SpecBadge spec={p.spec} wowClass={p.wowClass} iconOnly />}
                  <span
                    className="font-medium"
                    style={{
                      color:
                        p.wowClass && p.wowClass in CLASS_TEXT_COLORS
                          ? CLASS_TEXT_COLORS[p.wowClass as WowClass]
                          : undefined,
                    }}
                  >
                    {p.name}
                  </span>
                  {recruited && <span className="text-[10px] text-muted-foreground">recruited</span>}
                  <button
                    type="button"
                    onClick={() => onRemove(p.name)}
                    title={`Remove ${p.name}`}
                    className="cursor-pointer opacity-0 transition-opacity duration-75 group-hover:opacity-60 hover:text-destructive hover:opacity-100"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
