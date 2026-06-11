"use client";

import { useState } from "react";
import { QUALITY_COLORS, iconUrl } from "@/lib/constants/wow";
import type { Quality } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Item icon from the Wowhead CDN with a quality-colored ring.
 * Falls back to a neutral placeholder when the icon is missing or blocked.
 */
export function ItemIcon({
  icon,
  quality = "common",
  size = 22,
  className,
}: {
  icon?: string;
  quality?: Quality;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ringColor =
    quality === "common" || quality === "poor" ? undefined : QUALITY_COLORS[quality];
  const style = {
    width: size,
    height: size,
    borderColor: ringColor,
  };

  if (!icon || failed) {
    return (
      <span
        aria-hidden
        className={cn("inline-block shrink-0 rounded-sm border bg-muted", className)}
        style={style}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny CDN icons, next/image is overkill
    <img
      src={iconUrl(icon, size >= 40 ? "large" : size >= 28 ? "medium" : "small")}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-sm border", className)}
      style={style}
    />
  );
}
