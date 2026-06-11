import Link from "next/link";
import { ItemIcon } from "@/components/item-icon";
import { QUALITY_TEXT_COLORS } from "@/lib/constants/wow";
import type { Quality } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Serializable reference to an item — what callers resolve from the item cache. */
export interface ItemRef {
  itemId: number;
  name?: string;
  quality?: Quality;
  icon?: string;
}

/**
 * Internal link to the item page, with quality-colored name, CDN icon and a
 * Wowhead hover tooltip (via data-wowhead). Purely presentational: callers
 * pass resolved fields so this works in both server and client trees.
 */
export function ItemLink({
  item,
  size = "md",
  showIcon = true,
  className,
}: {
  item: ItemRef;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  className?: string;
}) {
  const quality = item.quality ?? "common";
  const iconSize = size === "sm" ? 18 : size === "lg" ? 32 : 22;
  return (
    <Link
      href={`/items/${item.itemId}`}
      data-wowhead={`item=${item.itemId}&domain=tbc`}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 hover:underline",
        size === "sm" ? "text-xs" : "text-sm",
        className,
      )}
    >
      {showIcon && <ItemIcon icon={item.icon} quality={quality} size={iconSize} />}
      <span className="truncate font-medium" style={{ color: QUALITY_TEXT_COLORS[quality] }}>
        {item.name ?? `Item #${item.itemId}`}
      </span>
    </Link>
  );
}
