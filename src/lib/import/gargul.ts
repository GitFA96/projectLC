import type { Quality } from "@/lib/constants/wow";

/**
 * Gargul award-export parser. Gargul's export format is user-configurable, so
 * instead of fixing column positions this classifies each column by shape
 * (date, time, item id, item link, OS flag) and treats what's left as item
 * name + winner. Handles the recommended format @DATE;@TIME;@ID;@ITEM;@WINNER;@OS
 * plus @LINK variants (in-game item links carry id, name and quality color).
 * Pure module — shared by the client preview and the server commit.
 *
 * TODO(M3): validate against a real Gargul export — unlike the SixtyUpgrades
 * parser (built on a real fixture), this format is still assumed.
 */

export interface ParsedGargulLine {
  /** ISO local timestamp (no zone — Gargul logs wall-clock raid time). */
  awardedAt: string;
  itemId: number;
  itemName: string;
  rawWinnerName: string;
  offspec: boolean;
  /** Only when the paste contained an item link — its color encodes quality. */
  quality?: Quality;
}

export interface GargulParseResult {
  lines: ParsedGargulLine[];
  warnings: string[];
}

const LINK_RE = /\|c[fF]{2}([0-9a-fA-F]{6})\|Hitem:(\d+)[^|]*\|h\[([^\]]+)\]\|h\|r/;

const COLOR_TO_QUALITY: Record<string, Quality> = {
  "9d9d9d": "poor",
  ffffff: "common",
  "1eff00": "uncommon",
  "0070dd": "rare",
  a335ee: "epic",
  ff8000: "legendary",
};

const DATE_ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DATE_EU_RE = /^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;
const OS_RE = /^(0|1|os|ms|offspec|mainspec|main spec|off spec|yes|no|true|false)$/i;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026-06-04" stays; "04/06/2026" and "04.06.26" are read day-first (EU). */
function normalizeDate(raw: string): string | undefined {
  const iso = DATE_ISO_RE.exec(raw);
  if (iso) return `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const eu = DATE_EU_RE.exec(raw);
  if (eu) {
    const year = eu[3].length === 2 ? `20${eu[3]}` : eu[3];
    return `${year}-${pad(Number(eu[2]))}-${pad(Number(eu[1]))}`;
  }
  return undefined;
}

function isOffspec(raw: string): boolean {
  return /^(1|os|offspec|off spec|yes|true)$/i.test(raw);
}

function detectDelimiter(line: string): string {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

export function parseGargulExport(
  text: string,
  opts: { fallbackDate?: string } = {},
): GargulParseResult {
  const lines: ParsedGargulLine[] = [];
  const warnings: string[] = [];
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (const [i, rawLine] of rawLines.entries()) {
    const lineNo = i + 1;
    const cols = rawLine.split(detectDelimiter(rawLine)).map((c) => c.trim());

    let date: string | undefined;
    let time: string | undefined;
    let itemId: number | undefined;
    let itemName: string | undefined;
    let quality: Quality | undefined;
    let offspec: boolean | undefined;
    const rest: string[] = [];

    for (const col of cols) {
      if (col === "") continue;
      const link = LINK_RE.exec(col);
      if (link && itemId === undefined) {
        quality = COLOR_TO_QUALITY[link[1].toLowerCase()];
        itemId = Number(link[2]);
        itemName = link[3];
        continue;
      }
      const asDate = normalizeDate(col);
      if (asDate && date === undefined) {
        date = asDate;
        continue;
      }
      const asTime = TIME_RE.exec(col);
      if (asTime && time === undefined) {
        time = `${pad(Number(asTime[1]))}:${asTime[2]}`;
        continue;
      }
      if (/^\d+$/.test(col)) {
        const n = Number(col);
        // Item IDs are large; a lone 0/1 is the offspec flag.
        if (n >= 100 && itemId === undefined) {
          itemId = n;
          continue;
        }
        if (n <= 1 && offspec === undefined) {
          offspec = n === 1;
          continue;
        }
      }
      if (OS_RE.test(col) && offspec === undefined) {
        offspec = isOffspec(col);
        continue;
      }
      rest.push(col.replace(/^\[(.+)\]$/, "$1"));
    }

    // Whatever wasn't classified: item name first (unless a link provided it), winner last.
    if (itemName === undefined && rest.length > 0) itemName = rest.shift();
    const winnerRaw = rest.shift();

    if (itemId === undefined || !itemName || !winnerRaw) {
      warnings.push(
        `Line ${lineNo} skipped — couldn't find ${[
          itemId === undefined ? "an item id (or item link)" : undefined,
          !itemName ? "an item name" : undefined,
          !winnerRaw ? "a winner" : undefined,
        ]
          .filter(Boolean)
          .join(" or ")} in “${rawLine.slice(0, 60)}${rawLine.length > 60 ? "…" : ""}”.`,
      );
      continue;
    }
    if (rest.length > 0) {
      warnings.push(`Line ${lineNo}: extra column(s) ignored (${rest.map((r) => `“${r}”`).join(", ")}).`);
    }

    if (!date) {
      date = opts.fallbackDate;
      if (!date) {
        warnings.push(`Line ${lineNo} skipped — no date in the line and no raid date set.`);
        continue;
      }
    }

    // Strip the realm from cross-realm names; keep exactly what remains.
    const rawWinnerName = winnerRaw.split("-")[0].trim();

    lines.push({
      awardedAt: `${date}T${time ?? "00:00"}:00`,
      itemId,
      itemName,
      rawWinnerName,
      offspec: offspec ?? false,
      quality,
    });
  }

  // In-paste duplicates (double-pasted exports) are dropped here; duplicates
  // against already-committed awards are handled at commit time.
  const seen = new Set<string>();
  const deduped = lines.filter((l) => {
    const key = `${l.itemId}|${l.rawWinnerName.toLowerCase()}|${l.awardedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (deduped.length < lines.length) {
    warnings.push(`${lines.length - deduped.length} duplicate line(s) in the paste were dropped.`);
  }

  return { lines: deduped, warnings };
}
