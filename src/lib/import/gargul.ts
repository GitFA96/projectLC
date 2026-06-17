import type { Quality } from "@/lib/constants/wow";

/**
 * Gargul award-export parser. Two paths, picked per paste:
 *
 *  1. Gargul's standard CSV export, which leads with a header row naming the
 *     columns — e.g. `dateTime,character,itemID,offspec,id`. When a header is
 *     detected each column is read by name, so the trailing award `id` (a long
 *     checksum) is ignored and the winner/item can't get swapped — the bug the
 *     shape-guesser hit on this exact layout (no item-name column + a stray id
 *     number made it read the winner as the item and the id as the winner). The
 *     item name is optional on this path: the export carries only an item id,
 *     and the name is resolved from the item cache at commit time.
 *
 *  2. A header-less paste in the recommended custom format
 *     `@DATE;@TIME;@ID;@ITEM;@WINNER;@OS` (and friends). Each column is then
 *     classified by shape (date, time, item id, item link, OS flag) and what's
 *     left is item name + winner. Item links (@LINK) carry id, name and a
 *     quality color.
 *
 * Semicolon, comma and tab delimiters all work. Pure module — shared by the
 * client preview and the server commit.
 */

export interface ParsedGargulLine {
  /** ISO local timestamp (no zone — Gargul logs wall-clock raid time). */
  awardedAt: string;
  itemId: number;
  /** Absent when the export gave only an item id — resolved from the cache later. */
  itemName?: string;
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

function normalizeTime(raw: string): string | undefined {
  const t = TIME_RE.exec(raw);
  return t ? `${pad(Number(t[1]))}:${t[2]}` : undefined;
}

/**
 * One combined "dateTime" cell, in whatever shape Gargul was configured to
 * emit: a bare date, "date time" / "dateTtime", or a unix epoch (seconds or
 * milliseconds). The time half is optional — the raid date is the fallback.
 */
function normalizeDateTime(raw: string): { date?: string; time?: string } {
  const split = /^(.+?)[ T](\d{1,2}:\d{2}(?::\d{2})?)$/.exec(raw);
  if (split) return { date: normalizeDate(split[1].trim()), time: normalizeTime(split[2]) };
  const dateOnly = normalizeDate(raw);
  if (dateOnly) return { date: dateOnly };
  const timeOnly = normalizeTime(raw);
  if (timeOnly) return { time: timeOnly };
  if (/^\d{9,}$/.test(raw)) {
    const d = new Date(raw.length >= 12 ? Number(raw) : Number(raw) * 1000);
    if (!Number.isNaN(d.getTime())) {
      return {
        date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
        time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
      };
    }
  }
  return {};
}

function isOffspec(raw: string): boolean {
  return /^(1|os|offspec|off spec|yes|true)$/i.test(raw);
}

function detectDelimiter(line: string): string {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

/** Per-line fields, filled by either parsing path, then validated together. */
interface Draft {
  date?: string;
  time?: string;
  itemId?: number;
  itemName?: string;
  quality?: Quality;
  offspec?: boolean;
  winnerRaw?: string;
}

/* ---- header-aware path ---- */

type HeaderField =
  | "datetime"
  | "date"
  | "time"
  | "itemId"
  | "itemName"
  | "itemLink"
  | "winner"
  | "offspec"
  | "ignore";

/** Column-name (letters only, lower-cased) → field. `id` is the award checksum — ignored. */
const HEADER_FIELDS: Record<string, HeaderField> = {
  datetime: "datetime",
  timestamp: "datetime",
  date: "date",
  day: "date",
  time: "time",
  itemid: "itemId",
  item: "itemId",
  itemname: "itemName",
  name: "itemName",
  itemlink: "itemLink",
  link: "itemLink",
  character: "winner",
  char: "winner",
  player: "winner",
  winner: "winner",
  who: "winner",
  offspec: "offspec",
  os: "offspec",
  spec: "offspec",
  mainspec: "offspec",
  id: "ignore",
  uuid: "ignore",
  checksum: "ignore",
  hash: "ignore",
};

function headerFieldFor(cell: string): HeaderField | undefined {
  return HEADER_FIELDS[cell.toLowerCase().replace(/[^a-z]/g, "")];
}

/** A cell carrying award data (not a column name): a real first row has ≥1. */
function looksLikeData(cell: string): boolean {
  if (LINK_RE.test(cell)) return true;
  if (normalizeDate(cell)) return true;
  if (TIME_RE.test(cell)) return true;
  return /^\d+$/.test(cell) && Number(cell) >= 100;
}

/**
 * Read the first row as a header only when it purely names columns (no award
 * data) and we recognize a winner column plus something item-ish. Returns the
 * per-column field map, or undefined to fall back to shape-based parsing.
 */
function detectHeader(cols: string[]): (HeaderField | undefined)[] | undefined {
  if (cols.some(looksLikeData)) return undefined;
  const fields = cols.map(headerFieldFor);
  const recognized = fields.filter(Boolean).length;
  if (recognized < Math.max(2, Math.ceil(cols.length / 2))) return undefined;
  if (!fields.includes("winner")) return undefined;
  if (!fields.includes("itemId") && !fields.includes("itemLink") && !fields.includes("itemName")) {
    return undefined;
  }
  return fields;
}

/** An item-ish cell: an in-game link, a bare id, or (tolerated) a name. */
function readItemCell(cell: string, d: Draft): void {
  const link = LINK_RE.exec(cell);
  if (link) {
    d.quality ??= COLOR_TO_QUALITY[link[1].toLowerCase()];
    d.itemId ??= Number(link[2]);
    d.itemName ??= link[3];
    return;
  }
  if (/^\d+$/.test(cell)) d.itemId ??= Number(cell);
  else d.itemName ??= cell.replace(/^\[(.+)\]$/, "$1");
}

function draftFromHeader(cols: string[], fields: (HeaderField | undefined)[]): Draft {
  const d: Draft = {};
  cols.forEach((cell, i) => {
    if (cell === "") return;
    switch (fields[i]) {
      case "datetime": {
        const dt = normalizeDateTime(cell);
        d.date ??= dt.date;
        d.time ??= dt.time;
        break;
      }
      case "date":
        d.date ??= normalizeDate(cell);
        break;
      case "time":
        d.time ??= normalizeTime(cell);
        break;
      case "offspec":
        d.offspec ??= isOffspec(cell);
        break;
      case "itemId":
      case "itemName":
      case "itemLink":
        readItemCell(cell, d);
        break;
      case "winner":
        d.winnerRaw ??= cell;
        break;
      default:
        break; // ignore / unrecognized columns
    }
  });
  return d;
}

/* ---- shape-based (header-less) path ---- */

/** Classify each column by shape; leftover text is item name (first) + winner (last). */
function draftFromShape(cols: string[]): { draft: Draft; extra: string[] } {
  const d: Draft = {};
  const rest: string[] = [];
  for (const col of cols) {
    if (col === "") continue;
    const link = LINK_RE.exec(col);
    if (link && d.itemId === undefined) {
      d.quality = COLOR_TO_QUALITY[link[1].toLowerCase()];
      d.itemId = Number(link[2]);
      d.itemName = link[3];
      continue;
    }
    const asDate = normalizeDate(col);
    if (asDate && d.date === undefined) {
      d.date = asDate;
      continue;
    }
    const asTime = normalizeTime(col);
    if (asTime && d.time === undefined) {
      d.time = asTime;
      continue;
    }
    if (/^\d+$/.test(col)) {
      const n = Number(col);
      // Item IDs are large; a lone 0/1 is the offspec flag.
      if (n >= 100 && d.itemId === undefined) {
        d.itemId = n;
        continue;
      }
      if (n <= 1 && d.offspec === undefined) {
        d.offspec = n === 1;
        continue;
      }
      // Any other bare number is an award id / checksum / count — never a
      // name or winner, so drop it rather than mistaking it for one.
      continue;
    }
    if (OS_RE.test(col) && d.offspec === undefined) {
      d.offspec = isOffspec(col);
      continue;
    }
    rest.push(col.replace(/^\[(.+)\]$/, "$1"));
  }

  // Whatever wasn't classified: item name first (unless a link gave it), winner last.
  if (d.itemName === undefined && rest.length > 0) d.itemName = rest.shift();
  d.winnerRaw = rest.shift();
  return { draft: d, extra: rest };
}

function snippet(line: string): string {
  return `${line.slice(0, 60)}${line.length > 60 ? "…" : ""}`;
}

/** Shared validation: turn a Draft into a line, or push a skip warning. */
function finalize(
  d: Draft,
  lineNo: number,
  rawLine: string,
  fallbackDate: string | undefined,
  lines: ParsedGargulLine[],
  warnings: string[],
): void {
  if (d.itemId === undefined || !d.winnerRaw) {
    warnings.push(
      `Line ${lineNo} skipped — couldn't find ${[
        d.itemId === undefined ? "an item id (or item link)" : undefined,
        !d.winnerRaw ? "a winner" : undefined,
      ]
        .filter(Boolean)
        .join(" or ")} in “${snippet(rawLine)}”.`,
    );
    return;
  }
  const date = d.date ?? fallbackDate;
  if (!date) {
    warnings.push(`Line ${lineNo} skipped — no date in the line and no raid date set.`);
    return;
  }
  // Strip the realm from cross-realm names; keep exactly what remains.
  const rawWinnerName = d.winnerRaw.split("-")[0].trim();
  if (!rawWinnerName) {
    warnings.push(`Line ${lineNo} skipped — the winner column was empty.`);
    return;
  }

  lines.push({
    awardedAt: `${date}T${d.time ?? "00:00"}:00`,
    itemId: d.itemId,
    itemName: d.itemName,
    rawWinnerName,
    offspec: d.offspec ?? false,
    quality: d.quality,
  });
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

  // A leading header row (Gargul's standard CSV export) switches us to
  // parsing every following row positionally, by column name.
  let headerFields: (HeaderField | undefined)[] | undefined;
  let firstDataIndex = 0;
  if (rawLines.length > 0) {
    const headerCols = rawLines[0].split(detectDelimiter(rawLines[0])).map((c) => c.trim());
    const detected = detectHeader(headerCols);
    if (detected) {
      headerFields = detected;
      firstDataIndex = 1;
      if (rawLines.length === 1) {
        warnings.push("Only the column header was pasted — include the award rows beneath it too.");
      }
    }
  }

  for (let i = firstDataIndex; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const lineNo = i + 1;
    const cols = rawLine.split(detectDelimiter(rawLine)).map((c) => c.trim());

    if (headerFields) {
      finalize(draftFromHeader(cols, headerFields), lineNo, rawLine, opts.fallbackDate, lines, warnings);
    } else {
      const { draft, extra } = draftFromShape(cols);
      finalize(draft, lineNo, rawLine, opts.fallbackDate, lines, warnings);
      if (draft.itemId !== undefined && draft.winnerRaw && extra.length > 0) {
        warnings.push(`Line ${lineNo}: extra column(s) ignored (${extra.map((r) => `“${r}”`).join(", ")}).`);
      }
    }
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
