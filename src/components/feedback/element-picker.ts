import { truncate } from "@/lib/feedback";
import type { FeedbackContext } from "@/lib/types";

/**
 * Turning "the thing I clicked" into something a developer can find again.
 *
 * DOM-only, so it sits outside `src/lib/feedback.ts` (the test environment is
 * `node` and has no document). The rules here are all about being useful to
 * whoever reads the report a week later: prefer what a human would say
 * ("the Award button"), and fall back to structure only when there's no text.
 */

/** Marks the widget's own UI so the picker never offers to report itself. */
export const PICKER_IGNORE_ATTR = "data-feedback-ui";

/** The visible text of an element, ignoring anything the picker itself drew. */
function visibleText(el: Element): string {
  return truncate(el.textContent ?? "", 120);
}

/**
 * What to call this element in one line.
 *
 * An accessible name beats text content beats the tag alone — the same order a
 * screen reader would use, and for the same reason: it's what the element is
 * *for*, not what it's made of.
 */
function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const kind = role ? `${tag} (${role})` : tag;

  const ariaLabel = el.getAttribute("aria-label");
  const title = el.getAttribute("title");
  const alt = el instanceof HTMLImageElement ? el.alt : null;
  const name = ariaLabel || alt || title || visibleText(el);

  return truncate(name ? `${kind} “${truncate(name, 60)}”` : kind, 200);
}

/**
 * A CSS path from an id-anchored ancestor down to the element.
 *
 * Stops at the first id because that's both shorter and more stable than a
 * chain of nth-child from <body>. Capped at six steps — beyond that the path
 * is noise, and the element label is what actually locates it.
 */
function cssPath(el: Element): string {
  const steps: string[] = [];
  let node: Element | null = el;

  while (node && node.tagName.toLowerCase() !== "html" && steps.length < 6) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      steps.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      steps.unshift(tag);
      break;
    }
    const twins = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    steps.unshift(twins.length > 1 ? `${tag}:nth-of-type(${twins.indexOf(node) + 1})` : tag);
    node = parent;
  }
  return truncate(steps.join(" > "), 500);
}

/** Everything the picker knows about one element, in the shape the report stores. */
export function contextForElement(el: Element): Pick<
  FeedbackContext,
  "elementLabel" | "elementSelector" | "elementText"
> {
  const text = visibleText(el);
  return {
    elementLabel: describeElement(el),
    elementSelector: cssPath(el),
    elementText: text ? truncate(text, 300) : undefined,
  };
}

/** True when the element belongs to the feedback widget itself. */
export function isWidgetChrome(el: Element | null): boolean {
  return !!el?.closest(`[${PICKER_IGNORE_ATTR}]`);
}
