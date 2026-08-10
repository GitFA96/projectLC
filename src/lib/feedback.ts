import type { FeedbackContext, FeedbackReport } from "@/lib/types";

/**
 * Pure helpers for the bug-report widget. The DOM walking lives in the widget
 * itself; what's here is the part worth testing — deriving what we tell the
 * reporter we're collecting, and keeping every field inside the lengths the
 * zod schema will accept, so a long page never turns into a rejected report.
 */

/** localStorage key holding the reporter's standing consent to send page details. */
export const FEEDBACK_CONSENT_KEY = "projectlc-feedback-context-consent";
/** localStorage key holding the name they last signed a report with. */
export const FEEDBACK_NAME_KEY = "projectlc-feedback-name";

/** Trim to `max`, marking the cut so a truncated selector isn't mistaken for a short one. */
export function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * A coarse "Chrome 141 on Windows" from a user-agent string.
 *
 * Deliberately lossy: the raw UA is a near-unique fingerprint and we only ever
 * need it to answer "does this reproduce on their browser". Returns undefined
 * rather than guessing when nothing matches, so the widget can just omit the
 * line instead of showing the reporter something wrong.
 */
export function browserLabel(userAgent: string): string | undefined {
  if (!userAgent) return undefined;

  // Order matters as much as it does for the browsers below: an iPhone says
  // "like Mac OS X", and Android says "Linux".
  const os = /Windows/i.test(userAgent)
    ? "Windows"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "iOS"
      : /Android/i.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : undefined;

  // Order matters: every one of these also claims to be Chrome and/or Safari.
  const browser =
    /Edg\/(\d+)/.exec(userAgent) ??
    /OPR\/(\d+)/.exec(userAgent) ??
    /Firefox\/(\d+)/.exec(userAgent) ??
    /Chrome\/(\d+)/.exec(userAgent) ??
    /Version\/(\d+).*Safari/.exec(userAgent);

  const name = !browser
    ? undefined
    : browser[0].startsWith("Edg")
      ? "Edge"
      : browser[0].startsWith("OPR")
        ? "Opera"
        : browser[0].startsWith("Firefox")
          ? "Firefox"
          : browser[0].startsWith("Chrome")
            ? "Chrome"
            : "Safari";

  if (!name && !os) return undefined;
  if (!name) return os;
  const version = browser?.[1] ? ` ${browser[1]}` : "";
  return os ? `${name}${version} on ${os}` : `${name}${version}`;
}

/**
 * The context, rendered as the exact lines shown to the reporter before they
 * send. The widget displays this and the report stores the same object — one
 * function so the two can't drift and show them something we didn't send.
 */
export function contextLines(context: FeedbackContext): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (context.elementLabel) lines.push({ label: "Element", value: context.elementLabel });
  if (context.elementText) lines.push({ label: "Its text", value: context.elementText });
  if (context.elementSelector) lines.push({ label: "Path", value: context.elementSelector });
  if (context.viewport) lines.push({ label: "Window", value: context.viewport });
  if (context.theme) lines.push({ label: "Theme", value: context.theme });
  if (context.browser) lines.push({ label: "Browser", value: context.browser });
  return lines;
}

/** True when there is nothing in the context worth sending or showing. */
export function isEmptyContext(context: FeedbackContext | undefined): boolean {
  return !context || contextLines(context).length === 0;
}

/* ---- handing a report to someone who will fix it ----------------------- */

/**
 * The App Router file a route was most likely rendered by.
 *
 * Mechanical, not clever: App Router maps `/logs` to `src/app/logs/page.tsx`,
 * and a path segment that looks like a value rather than a name becomes a
 * `[dynamic]` folder. It is a starting point for a search, which is why the
 * export labels it "likely" — a route rendered mostly by a client component
 * will have its real bug somewhere under `src/components`.
 */
export function likelyRouteFile(route: string): string {
  const segments = route.split("/").filter(Boolean);
  if (segments.length === 0) return "src/app/page.tsx";

  const mapped = segments.map((segment) => {
    // A segment carrying a value — a name, an id, a slug — is a dynamic one.
    // Static route segments in this app are all lowercase words or hyphenated.
    const looksDynamic = /[^a-z0-9-]/.test(segment) || /\d/.test(segment);
    return looksDynamic ? "[param]" : segment;
  });
  return `src/app/${mapped.join("/")}/page.tsx`;
}

const KIND_HEADING = { bug: "Bug", feedback: "Feedback" } as const;

/**
 * One report as markdown, for pasting to whoever (or whatever) will act on it.
 *
 * Written for a reader who was not there: the reporter's own words first and
 * unedited, then where they were, then the machine detail. An agent handed
 * this should be able to open the right file without asking a question.
 */
export function formatReportForAgent(report: FeedbackReport): string {
  const lines: string[] = [];
  const firstLine = report.body.split("\n")[0].trim();
  const title = truncate(firstLine, 80);

  lines.push(`## ${KIND_HEADING[report.kind]}: ${title}`);
  lines.push("");
  lines.push(`- **Filed** ${report.createdAt}${report.reporter ? ` by ${report.reporter}` : ""}`);
  lines.push(
    `- **Status** ${report.status}${report.priority === "unset" ? "" : ` · **${report.priority}**`}`,
  );
  lines.push(`- **Route** \`${report.route}\` — likely \`${likelyRouteFile(report.route)}\``);
  lines.push(`- **URL** ${report.url}`);

  const context = report.context;
  if (context?.elementLabel) {
    lines.push(`- **Element** ${context.elementLabel}`);
    if (context.elementSelector) lines.push(`- **Selector** \`${context.elementSelector}\``);
    if (context.elementText) lines.push(`- **Element text** ${context.elementText}`);
  }
  const environment = [context?.viewport, context?.theme, context?.browser].filter(Boolean);
  if (environment.length > 0) lines.push(`- **Environment** ${environment.join(" · ")}`);
  if (!context) lines.push(`- **Context** not shared by the reporter`);

  lines.push("");
  // Unedited and last, so nothing above can be mistaken for their words.
  lines.push("### What they wrote");
  lines.push("");
  lines.push(report.body.trim());

  // The officer's note goes after, under its own heading — whoever picks this
  // up has to be able to tell the decision from the complaint.
  if (report.adminNote) {
    lines.push("");
    lines.push("### Officer note");
    lines.push("");
    lines.push(report.adminNote.trim());
  }

  return lines.join("\n");
}

/** Several reports as one pasteable document, newest-first order preserved. */
export function formatReportsForAgent(reports: FeedbackReport[]): string {
  if (reports.length === 0) return "";
  const header = [
    `# projectLC — ${reports.length} report${reports.length === 1 ? "" : "s"}`,
    "",
    "Filed from the in-app widget. Paths are relative to the repository root.",
    "",
    "",
  ].join("\n");
  return header + reports.map(formatReportForAgent).join("\n\n---\n\n") + "\n";
}
