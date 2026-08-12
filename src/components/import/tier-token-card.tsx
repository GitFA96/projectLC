"use client";

import * as React from "react";
import { Coins, RefreshCw } from "lucide-react";
import { backfillTierTokens, type BackfillTokensResult } from "@/app/guild/import/item-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Teaching the tracker that a tier token and a tier piece are the same loot
 * decision.
 *
 * Gargul records what dropped — "Helm of the Vanquished Champion" — and a
 * SixtyUpgrades list names what the raider actually ends up wearing. Until
 * this has run, those never meet: the token's page shows nobody wanting it,
 * the winner's wishlist row stays open, and the loot plan calls a tier drop
 * unwanted.
 *
 * The mapping is read off Wowhead's own vendor listing rather than typed in,
 * which is why it is a button and not a shipped table.
 */
export function TierTokenCard({
  tokensToMap,
  unchecked,
}: {
  /** Tokens already identified whose pieces haven't been read yet. */
  tokensToMap: number;
  /** Ids nobody has asked Wowhead about — mostly not tokens, and that's fine. */
  unchecked: number;
}) {
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<BackfillTokensResult | null>(null);

  const run = () =>
    startTransition(async () => {
      setResult(await backfillTierTokens());
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Coins className="h-4 w-4 text-muted-foreground" />
          Tier tokens
          {tokensToMap > 0 ? (
            <span className="rounded-full bg-warn-fill px-2 py-0.5 text-[11px] font-medium text-warn-ink">
              {tokensToMap} token{tokensToMap === 1 ? "" : "s"} to map
            </span>
          ) : (
            unchecked > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {unchecked} id{unchecked === 1 ? "" : "s"} unasked
              </span>
            )
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A tier token is the one drop that isn&apos;t the thing anyone wants: the boss drops
          the token, the raider walks out of Shattrath with the piece, and a wishlist only ever
          names the piece. This asks Wowhead which pieces each token buys, so a token win
          satisfies the wishlist slot it was won for, counts as loot owed, and puts every
          contender for that tier slot on the token&apos;s own board. Nothing here is written
          from memory — the list comes from the vendor table on Wowhead&apos;s page for each
          token, and the arena sets that take the same token are deliberately left out.
          A batch per press, and loot the guild has actually won is asked about first — so
          the tokens in your ledger are mapped by the second or third press, and the long
          tail of gems and consumables behind them can be left undrained without costing
          anything.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={pending}>
          <RefreshCw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          {pending ? "Mapping…" : "Map tier tokens"}
        </Button>
        {result && (
          <span className={result.ok ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {result.message}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
