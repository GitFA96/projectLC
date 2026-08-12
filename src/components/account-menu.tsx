"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { LogIn, LogOut, ShieldCheck, User } from "lucide-react";
import { signOutAction, whoAmI, type Whoami } from "@/app/account-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Who you are, and the way out.
 *
 * Asks the server after mount rather than being handed the answer as a prop.
 * The alternative — resolving the session in `layout.tsx` — reads a cookie
 * during render, which opts **every page in the app** out of static rendering.
 * That is a real decision about how this app renders and it belongs to read
 * gating, not to a menu in the corner. So the chrome catches up a moment late,
 * which costs nothing: nothing on the page depends on it.
 *
 * Renders nothing at all until the answer arrives. A placeholder that says
 * "Sign in" and then changes to your name is worse than a beat of empty space —
 * it tells you something false first.
 */
export function AccountMenu() {
  const pathname = usePathname();
  const [me, setMe] = React.useState<Whoami | null>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    let live = true;
    whoAmI()
      .then((next) => {
        if (live) setMe(next);
      })
      .catch(() => {
        // No answer is not the same as "signed out", and guessing either way
        // would be a lie. Stay silent; the next navigation asks again.
      });
    return () => {
      live = false;
    };
    // Re-asked on navigation, so signing in or out elsewhere catches up here.
  }, [pathname]);

  if (!me) return null;

  if (!me.signedIn) {
    return (
      <a
        href={`/signin?returnTo=${encodeURIComponent(pathname)}`}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogIn className="h-3.5 w-3.5" />
        Sign in
      </a>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          open && "bg-accent text-foreground",
        )}
      >
        <User className="h-3.5 w-3.5" />
        {me.displayName ?? "Signed in"}
      </button>

      {open && (
        <>
          {/* Click-anywhere-else to close. A plain overlay rather than a
              document listener: it cannot leak, and it cannot fight the button
              underneath it for the same click. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-1 w-64 space-y-3 rounded-md border bg-card p-3 shadow-md"
          >
            <div className="space-y-1">
              <p className="text-sm font-medium">{me.displayName ?? "Signed in"}</p>
              <p className="text-xs text-muted-foreground">Signed in with Discord.</p>
            </div>

            {me.appAdmin && (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                operator
              </Badge>
            )}

            {/*
             * "Signed in" and "being signed in matters" are different facts.
             * While enforcement is off every check passes for everybody, and
             * somebody reading their own name here would otherwise reasonably
             * assume the opposite.
             */}
            {!me.enforcing && (
              <p className="rounded-md border border-warn-line bg-warn-soft p-2 text-xs text-warn-ink">
                Permissions aren&apos;t being enforced on this deployment yet, so signing in
                doesn&apos;t change what anyone can do.
              </p>
            )}

            <form
              action={() => {
                startTransition(async () => {
                  await signOutAction();
                });
              }}
            >
              <Button type="submit" size="sm" variant="outline" className="w-full" disabled={pending}>
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
