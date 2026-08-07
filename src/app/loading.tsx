/**
 * Shown while a route segment is still on the server.
 *
 * Without this file, App Router has nothing to swap in when a link is clicked,
 * so it holds the *old* page on screen until the new one is ready — the click
 * reads as broken, and then the whole page appears at once. A loading boundary
 * turns that dead time into a response.
 *
 * Deliberately at the app root: every page gets it, and one that renders fast
 * enough never shows it. The shape is a page header plus a table, because that
 * is what most of this app is; it is a placeholder, not a promise about the
 * specific page being loaded.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-5">
        <div className="h-6 w-48 rounded-md bg-muted" />
        <div className="mt-2 h-4 w-80 rounded-md bg-muted/60" />
      </div>
      <div className="mb-3 flex gap-2">
        <div className="h-8 w-40 rounded-md bg-muted/60" />
        <div className="h-8 w-28 rounded-md bg-muted/60" />
        <div className="h-8 w-28 rounded-md bg-muted/60" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-8 rounded-md bg-muted/40"
            // Fading down the list reads as "still arriving" rather than as
            // twelve identical rows that failed to load.
            style={{ opacity: 1 - i * 0.06 }}
          />
        ))}
      </div>
    </div>
  );
}
