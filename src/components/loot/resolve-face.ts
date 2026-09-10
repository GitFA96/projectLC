/**
 * What the ledger's winner control says about an award that has no roster
 * character behind it.
 *
 * Its own module, with no React and no server action in the import chain, so a
 * node-environment test can reach it — the same reason `pagerRange` sits beside
 * the pager rather than inside it.
 *
 * The rule it encodes: the control names the **state** the award is in, never
 * the action available on it. Both states used to read "Resolve", which meant a
 * row an officer had already settled off-roster looked exactly like one nobody
 * had touched — so it was opened again by whoever scanned the ledger next, every
 * week, and the ledger never looked finished. The menu stays on both, because
 * "off roster" is a call an officer is allowed to take back.
 */

/** The two states an award with no linked roster character can be in. */
export type ResolveMode = "unresolved" | "external";

export interface ResolveControlFace {
  /** What the trigger reads. */
  label: string;
  /** Why it reads that, said in full on hover. */
  title: string;
  /** Whether an officer still has something to decide here. */
  open: boolean;
}

export function resolveControlFace(mode: ResolveMode): ResolveControlFace {
  return mode === "external"
    ? {
        label: "Off roster",
        title:
          "Settled off roster — disenchanted, banked or given to a PUG. Open this to hand it to a character instead.",
        open: false,
      }
    : {
        label: "Resolve",
        title: "Not matched to a roster character — pick the winner, or mark it off roster.",
        open: true,
      };
}
