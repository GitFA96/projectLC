"use client";

import * as React from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type ItemRef } from "@/components/item-link";
import { type Quality } from "@/lib/constants/wow";
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

export interface ItemResolver {
  resolve: (itemId: number, fallbackName?: string) => ItemRef;
  isKnown: (itemId: number) => boolean;
}

export function makeItemResolver(items: KnownItem[]): ItemResolver {
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

export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          {w}
        </li>
      ))}
    </ul>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return <p className="rounded-md border border-danger-line bg-danger-soft p-2 text-sm text-danger-ink">{message}</p>;
}

/** ms into the report → "1:23:45" / "23:45". */
export function fmtOffset(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function CommitButton({ pending, onClick, disabled, children }: {
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
  /**
   * Set when this report saw an aura the tables have since learned to place:
   * re-importing it would change a real number. Absent means nothing to gain —
   * including for a report imported before the dump was kept, which records no
   * dump at all and so cannot be asked.
   */
  stale?: { pulls: number; learned: string[] };
}
