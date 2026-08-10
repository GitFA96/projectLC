"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Bug, Check, Crosshair, Lightbulb, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { submitFeedback } from "@/app/admin/feedback/actions";
import {
  FEEDBACK_CONSENT_KEY,
  FEEDBACK_NAME_KEY,
  browserLabel,
  contextLines,
} from "@/lib/feedback";
import {
  PICKER_IGNORE_ATTR,
  contextForElement,
  isWidgetChrome,
} from "@/components/feedback/element-picker";
import type { FeedbackContext, FeedbackKind } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The two entry points. Same workflow, same consent, different question —
 * "what broke" and "what would be better" are answered in different words, and
 * a placeholder that asks for the wrong one gets you the wrong report.
 */
const KINDS = {
  bug: {
    icon: Bug,
    button: "Report a bug",
    title: "Report a bug",
    prompt: "What did you expect, and what happened instead?",
    placeholder: "The gold column shows 0 for everyone after I imported last night's log…",
    pick: "Point at the problem",
  },
  feedback: {
    icon: Lightbulb,
    button: "Feedback",
    title: "Give feedback",
    prompt: "What would make this better?",
    placeholder: "It'd help if the roster remembered the sort order between visits…",
    pick: "Point at what you mean",
  },
} as const satisfies Record<FeedbackKind, unknown>;

/**
 * "Something's wrong here" — from any page, without leaving it.
 *
 * The design problem is consent. A bug report is far more useful with the page
 * and the element attached, and collecting that quietly would be both rude and
 * the kind of thing nobody notices until they do. So:
 *
 *  - page details are **off until switched on**, per browser, and the switch is
 *    the only thing that turns them on — nothing else flips it;
 *  - the exact values are printed in the panel, not summarised or hidden behind
 *    a "learn more", and they're rendered from the same object that gets sent;
 *  - pointing at an element is disabled while details are off, so the feature
 *    can't quietly become the reason context appears in a report.
 *
 * The consequence is that a first-time reporter sends prose only. That's the
 * right trade: a report we're allowed to keep beats a richer one we aren't.
 */

type Phase = "closed" | "form" | "picking" | "sent";

export function FeedbackWidget() {
  const pathname = usePathname();
  const [phase, setPhase] = React.useState<Phase>("closed");
  const [kind, setKind] = React.useState<FeedbackKind>("bug");
  const [body, setBody] = React.useState("");
  const [reporter, setReporter] = React.useState("");
  const [shareContext, setShareContext] = React.useState(false);
  const [picked, setPicked] = React.useState<FeedbackContext | undefined>();
  const [error, setError] = React.useState<string | undefined>();
  const [pending, startTransition] = React.useTransition();
  /** Bounding box of whatever the pointer is over, while picking. */
  const [highlight, setHighlight] = React.useState<DOMRect | undefined>();

  // Restore the standing consent and the name they last used. Reading these on
  // open (not on mount) keeps the closed widget free of storage access.
  const openPanel = (next: FeedbackKind) => {
    setKind(next);
    try {
      setShareContext(localStorage.getItem(FEEDBACK_CONSENT_KEY) === "yes");
      setReporter(localStorage.getItem(FEEDBACK_NAME_KEY) ?? "");
    } catch {
      // Storage blocked — details stay off, which is the safe default.
    }
    setError(undefined);
    setPhase("form");
  };

  const reset = () => {
    setPhase("closed");
    setBody("");
    setPicked(undefined);
    setHighlight(undefined);
    setError(undefined);
  };

  /* ---- element picking ------------------------------------------------- */

  React.useEffect(() => {
    if (phase !== "picking") return;

    const elementAt = (e: MouseEvent): Element | null => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el && !isWidgetChrome(el) ? el : null;
    };

    const onMove = (e: MouseEvent) => {
      const el = elementAt(e);
      setHighlight(el ? el.getBoundingClientRect() : undefined);
    };

    // Capture phase, so the page's own click handlers never see this click —
    // picking the "Delete" button must not delete anything.
    const onClick = (e: MouseEvent) => {
      const el = elementAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      setPicked((prev) => ({ ...prev, ...contextForElement(el) }));
      setHighlight(undefined);
      setPhase("form");
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setHighlight(undefined);
      setPhase("form");
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = prevCursor;
    };
  }, [phase]);

  /**
   * A picked element belongs to the page it was picked on. The panel outlives
   * a client-side navigation — it is fixed to the layout, not to the route —
   * so without this an element picked on one page is submitted stamped with
   * the route and URL of another, and the panel shows the two side by side as
   * though they belonged together.
   *
   * It is not hypothetical: a report of an item page's "Wowhead" link arrived
   * filed against a character page, and there is no such link on a character
   * page. Prose survives, because that is the reporter's; the context does
   * not, because it describes somewhere they have left.
   */
  const [pickedOn, setPickedOn] = React.useState(pathname);
  if (pickedOn !== pathname) {
    setPickedOn(pathname);
    setPicked(undefined);
    setHighlight(undefined);
    setPhase((current) => (current === "picking" ? "form" : current));
  }

  /* ---- what would be sent ---------------------------------------------- */

  /**
   * Built fresh on every render while the panel is open, so the lines the
   * reporter reads are the object that gets submitted — never a description of
   * one. Empty when consent is off, which is what makes the switch meaningful.
   */
  const context: FeedbackContext | undefined = React.useMemo(() => {
    if (!shareContext || phase === "closed") return undefined;
    return {
      ...picked,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      browser: browserLabel(navigator.userAgent),
    };
  }, [shareContext, picked, phase]);

  const toggleConsent = (next: boolean) => {
    setShareContext(next);
    try {
      if (next) localStorage.setItem(FEEDBACK_CONSENT_KEY, "yes");
      else localStorage.removeItem(FEEDBACK_CONSENT_KEY);
    } catch {
      // Not remembering it is survivable; the toggle still holds for this report.
    }
    // Turning details off discards what was already picked, rather than keeping
    // it around invisibly for the next time the switch goes on.
    if (!next) setPicked(undefined);
  };

  const send = () => {
    setError(undefined);
    startTransition(async () => {
      const result = await submitFeedback({
        kind,
        body,
        reporter: reporter.trim() || undefined,
        route: pathname,
        url: window.location.href,
        context,
      });
      if (!result.ok) {
        setError(result.message ?? "Could not send the report.");
        return;
      }
      try {
        if (reporter.trim()) localStorage.setItem(FEEDBACK_NAME_KEY, reporter.trim());
      } catch {
        // Fine — they'll retype it next time.
      }
      setPhase("sent");
    });
  };

  const lines = context ? contextLines(context) : [];

  return (
    <div {...{ [PICKER_IGNORE_ATTR]: "" }}>
      {/* The highlight follows the pointer during picking; it must not eat the click. */}
      {phase === "picking" && highlight && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-60 rounded-sm border-2 border-info bg-info/15"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
          }}
        />
      )}

      {phase === "picking" && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-61 flex justify-center">
          <p className="rounded-full border bg-popover px-3 py-1.5 text-xs shadow-lg">
            Click the thing that looks wrong · <kbd className="font-mono">Esc</kbd> to cancel
          </p>
        </div>
      )}

      {phase === "closed" && (
        // One pill, two entry points: the corner of every page is expensive,
        // and two separate floating buttons read as clutter rather than choice.
        <div className="fixed bottom-4 right-4 z-50 inline-flex h-9 items-center overflow-hidden rounded-full border bg-card shadow-lg">
          {(["bug", "feedback"] as const).map((entry, index) => {
            const Icon = KINDS[entry].icon;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => openPanel(entry)}
                className={cn(
                  "inline-flex h-full items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  index > 0 && "border-l",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {KINDS[entry].button}
              </button>
            );
          })}
        </div>
      )}

      {(phase === "form" || phase === "sent") && (
        <div
          role="dialog"
          aria-label={KINDS[kind].title}
          // Unmounted entirely while picking, so the panel never covers the
          // thing the reporter is trying to point at. The typed body survives
          // in state and comes back with the panel.
          className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-xl"
        >
          <button
            type="button"
            onClick={reset}
            aria-label="Close"
            className="absolute right-2.5 top-2.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>

          {phase === "sent" ? (
            <div className="py-2 text-center">
              <Check className="mx-auto h-6 w-6 text-success" aria-hidden />
              <p className="mt-2 text-sm font-medium">Thanks — that&apos;s logged.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                It&apos;s on the Feedback page with everything you saw above, and nothing you
                didn&apos;t.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={reset}>
                Close
              </Button>
            </div>
          ) : (
            <>
              <h2 className="pr-6 text-sm font-semibold">{KINDS[kind].title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{KINDS[kind].prompt}</p>

              {/* Switchable after the fact: people open "bug" and realise
                  halfway through that they're describing a wish. */}
              <div className="mt-2.5 flex gap-1" role="group" aria-label="Kind of report">
                {(["bug", "feedback"] as const).map((entry) => {
                  const Icon = KINDS[entry].icon;
                  const active = kind === entry;
                  return (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setKind(entry)}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-primary/30 bg-accent text-foreground"
                          : "text-muted-foreground hover:bg-accent/50",
                      )}
                    >
                      <Icon className="h-3 w-3" aria-hidden />
                      {KINDS[entry].button}
                    </button>
                  );
                })}
              </div>

              <Textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={KINDS[kind].placeholder}
                className="mt-2 min-h-24 text-sm"
                maxLength={4000}
              />

              <Input
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="Your name (optional)"
                className="mt-2 h-8 text-xs"
                maxLength={60}
              />

              {/* The opt-in. Everything it controls is printed directly beneath it. */}
              <div className="mt-3 rounded-md border bg-muted/40 p-2.5">
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={shareContext}
                    onChange={(e) => toggleConsent(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs leading-snug">
                    <span className="font-medium">Include the page details below.</span>{" "}
                    <span className="text-muted-foreground">
                      Helps pin the bug down. Nothing is sent unless this is on.
                    </span>
                  </span>
                </label>

                {shareContext && (
                  <div className="mt-2 space-y-1 border-t pt-2">
                    <Detail label="Page" value={pathname} />
                    {lines.map((line) => (
                      <Detail key={line.label} label={line.label} value={line.value} />
                    ))}

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setPhase("picking")}
                      >
                        <Crosshair className="h-3 w-3" aria-hidden />
                        {picked?.elementLabel ? "Point at something else" : KINDS[kind].pick}
                      </Button>
                      {picked?.elementLabel && (
                        <button
                          type="button"
                          onClick={() => setPicked(undefined)}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!shareContext && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Turn that on to point at the element that&apos;s wrong.
                </p>
              )}

              {error && <p className="mt-2 text-xs text-danger-ink">{error}</p>}

              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={send} disabled={pending || body.trim().length === 0}>
                  {pending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
                  Send report
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex gap-2 text-[11px] leading-snug">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 wrap-break-word font-mono text-foreground/80">{value}</span>
    </p>
  );
}
