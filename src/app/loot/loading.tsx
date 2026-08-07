/**
 * The ledger's own loading state.
 *
 * The root skeleton is a generic page shape; this one mirrors what actually
 * arrives — the session rail on the left, the filter row, then the table — so
 * the layout doesn't jump when the real thing replaces it. That shift is the
 * difference between "it's coming" and "it reloaded".
 *
 * The ledger earns a bespoke one because it is the slowest page to hydrate:
 * every row carries a checkbox and an edit button, so there is real time to
 * fill and it is worth filling with the right shape.
 */
export default function LootLoading() {
  return (
    <div aria-busy="true" aria-label="Loading the loot ledger">
      <div className="mb-5">
        <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
        <div className="mt-2 h-4 w-96 max-w-full animate-pulse rounded-md bg-muted/60" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[200px_1fr]">
        {/* Session rail — matches the real sidebar's widths so nothing shifts. */}
        <aside className="hidden space-y-1 lg:block">
          <div className="mb-2 h-3 w-24 animate-pulse rounded bg-muted/60" />
          {[88, 72, 80, 64, 76, 68].map((w, i) => (
            <div
              key={i}
              className="h-7 animate-pulse rounded-md bg-muted/40"
              style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
            />
          ))}
        </aside>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <div className="h-8 w-56 animate-pulse rounded-md bg-muted/60" />
            {[28, 24, 24, 20].map((w, i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-md bg-muted/40"
                style={{ width: `${w * 4}px`, animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>

          <div className="rounded-md border">
            <div className="flex h-9 items-center gap-4 border-b px-3">
              {[16, 12, 28, 18, 14].map((w, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-muted/60" style={{ width: `${w * 4}px` }} />
              ))}
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-4 border-b px-3 last:border-b-0">
                <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm bg-muted/50" />
                <div className="h-3 w-16 animate-pulse rounded bg-muted/40" />
                <div className="h-5 w-5 shrink-0 animate-pulse rounded bg-muted/50" />
                <div className="h-3 flex-1 animate-pulse rounded bg-muted/40" />
                <div className="h-3 w-20 animate-pulse rounded bg-muted/30" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
