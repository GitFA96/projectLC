import { extractReportCode } from "@/lib/wcl/client";

/**
 * Pulling every Warcraft Logs report out of one pasted blob.
 *
 * An officer collecting a phase's raids ends up with a list from a browser, a
 * Discord message or a spreadsheet — newline separated, comma separated, or
 * URLs with `#fight=` fragments still attached. Rather than ask them to
 * normalize that by hand, take the text as it comes and find the codes in it.
 *
 * Pure and order-preserving: the import queue runs in the order they pasted,
 * which is usually chronological and is what they'll be watching.
 */

/**
 * Report URLs anywhere in the text, including a locale prefix.
 *
 * A trailing query or fragment is swallowed as part of the URL so that
 * `#fight=1,2` can't leak its comma into the separator pass. The inner
 * lookahead stops at the next `http`, so two URLs pasted back to back with no
 * whitespace between them still read as two. Only `?`/`#` extend the match, so
 * a plain `code,code` list keeps its comma as a separator.
 */
const URL_CODE = /reports\/(?:[a-z]+-)?([a-zA-Z0-9]{10,32})(?:[?#](?:(?!https?:)[^\s])*)?/g;

export interface ParsedReportCodes {
  /** Unique codes, first occurrence wins, in the order pasted. */
  codes: string[];
  /** How many repeats were collapsed — worth saying so nobody re-imports twice. */
  duplicates: number;
  /** Non-empty fragments that looked like nothing we recognise. */
  invalid: string[];
}

export function parseReportCodes(text: string): ParsedReportCodes {
  const seen = new Set<string>();
  const codes: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  const add = (code: string) => {
    if (seen.has(code)) {
      duplicates += 1;
      return;
    }
    seen.add(code);
    codes.push(code);
  };

  /*
   * Find URLs first so their offsets are known, but DON'T consume them yet —
   * everything is merged by position at the end, or a paste that alternates
   * URLs and bare codes would come out grouped rather than in the order it was
   * written. The queue runs in this order and the officer is watching it.
   *
   * Matching URLs before splitting also means a fragment like `#fight=1,2`
   * can't be mistaken for a separator and chopped in half.
   */
  const found: { at: number; code?: string; text: string }[] = [];
  const covered: [number, number][] = [];
  for (const match of text.matchAll(URL_CODE)) {
    const at = match.index ?? 0;
    covered.push([at, at + match[0].length]);
    found.push({ at, code: match[1], text: match[0] });
  }

  // Bare tokens, skipping anything sitting inside a URL we already read.
  const token = /[^\s,;|]+/g;
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    const at = m.index;
    if (covered.some(([start, end]) => at < end && at + m![0].length > start)) continue;
    const trimmed = m[0].trim();
    if (!trimmed) continue;
    // Leftovers around a consumed URL (scheme, host, fragment) aren't user error.
    if (/^https?:$/i.test(trimmed) || /warcraftlogs\.com/i.test(trimmed)) continue;
    if (/^[#/?]/.test(trimmed)) continue;
    found.push({ at, code: extractReportCode(trimmed), text: trimmed });
  }

  for (const entry of found.sort((a, b) => a.at - b.at)) {
    if (entry.code) add(entry.code);
    else invalid.push(entry.text);
  }

  return { codes, duplicates, invalid };
}
