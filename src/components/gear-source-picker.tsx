"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface GearSourceOption {
  key: string;
  label: string;
  /** Heading this option files under — the raid night, or "Imported set". */
  group: string;
  /**
   * What the closed trigger reads when this option is picked. Radix resolves a
   * SelectValue from its items, which only mount once the dropdown opens — so
   * the label is passed in explicitly to survive server rendering.
   */
  triggerLabel: string;
}

/**
 * Which worn-gear snapshot the profile is showing.
 *
 * The choice lives in the URL (`?gear=`) rather than component state, so the
 * page keeps rendering one snapshot server-side instead of shipping every
 * boss's gear table to the browser — and a link to "what they wore on
 * Kael'thas" is shareable.
 */
export function GearSourcePicker({
  options,
  value,
  param = "gear",
  className = "w-full sm:w-80",
}: {
  options: GearSourceOption[];
  value: string;
  param?: string;
  /** Trigger width — narrow when the card shares a row with something else. */
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Groups in first-seen order: the imported set, then each night newest first.
  const groups: { name: string; options: GearSourceOption[] }[] = [];
  for (const option of options) {
    const group = groups.find((g) => g.name === option.group);
    if (group) group.options.push(option);
    else groups.push({ name: option.group, options: [option] });
  }

  function pick(next: string) {
    const params = new URLSearchParams(search);
    params.set(param, next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  return (
    <Select value={value} onValueChange={pick}>
      <SelectTrigger className={className} aria-label="Gear snapshot">
        <SelectValue>{options.find((o) => o.key === value)?.triggerLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.name}>
            <SelectLabel>{group.name}</SelectLabel>
            {group.options.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
