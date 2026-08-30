import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getRepo } from "@/lib/data/repo";
import { Nav } from "@/components/nav";
import { resolveViewer } from "@/lib/auth/viewer";
import { WowheadRefresher, WowheadScripts } from "@/components/wowhead";
import { TooltipProvider } from "@/components/ui/tooltip";
import { THEME_SCRIPT } from "@/lib/theme";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Nothing in this app is static, and saying so here is a security control.
 *
 * `resolveViewer()` short-circuits to `unrestrictedViewer()` when
 * `PROJECTLC_AUTH` is off, and that path never touches `cookies()`. No dynamic
 * API means Next happily prerenders the page **at build time, as a viewer with
 * every capability**, and then serves that HTML to everyone — the request-time
 * check never runs because there is no request.
 *
 * It stayed invisible because `.env.local` sets the flag, so a workstation
 * build marks every route `ƒ` and looks correct. A container build excludes
 * `.env.local` — correctly — and 14 capability-gated routes turned static,
 * `/roster` among them, serving the whole roster to anonymous callers.
 * Reproduced 30 Aug 2026 with `PROJECTLC_AUTH= npm run build`.
 *
 * Forcing it at the root makes the property structural rather than a thing each
 * page has to remember, and it costs nothing: every route reads the database,
 * so there was never a static shell to lose. `scripts/check-dynamic-routes.mjs`
 * fails the build if one comes back.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "projectLC — TBC Loot Council",
    template: "%s · projectLC",
  },
  description:
    "Loot council tracking for WoW TBC: character wishlists, gear progress and item distribution.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const repo = await getRepo();
  /*
   * The viewer is resolved here now, which it deliberately was not before.
   *
   * Reading a cookie in the layout opts every page out of static rendering —
   * which is why the account menu asks a server action after mount instead.
   * Read gating has since made every route dynamic anyway, so the cost is
   * already paid, and the alternative (a third round trip to answer "am I in
   * this guild") would be worse.
   */
  const [guild, viewer] = await Promise.all([repo.getGuild(), resolveViewer()]);
  // The banner says "you are inside this guild". An outsider on the public
  // profile is not, and the page they are looking at names the guild anyway.
  const inside = viewer.unrestricted || viewer.guild !== null;
  return (
    // suppressHydrationWarning: browser extensions (LanguageTool, dark-mode
    // togglers) stamp attributes onto <html> before React hydrates; only this
    // element's attributes are exempted, children still hydrate strictly.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Stamps the theme class on <html> before the browser paints, so a dark
          reader never gets a white flash. Must stay ahead of the stylesheet's
          first render — hence a raw inline script rather than next/script,
          which does not guarantee pre-paint execution.

          React logs "Encountered a script tag while rendering React component"
          against this line on every client re-render. It is dev-only noise
          about correct behaviour — the string appears only in
          react-dom-client.development.js, never in the production build — and
          it is saying the script will not run again on the client, which is
          exactly right: the theme is already stamped and re-running it would
          achieve nothing. Every way of silencing it is worse. `next/script`
          with beforeInteractive is documented as not blocking hydration, so the
          flash comes back; a <template> needs JS to activate it, so the flash
          comes back; reading the preference from a cookie instead would let the
          server stamp the class with no script at all, but it reads a cookie
          during layout render and opts EVERY page out of static rendering.
          Leave it alone.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <WowheadScripts />
        <WowheadRefresher />
        <TooltipProvider delayDuration={200}>
          <Nav
            guildName={inside ? guild.name : null}
            realm={inside ? guild.realm : null}
          />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
          <footer className="border-t py-4 text-center text-xs text-muted-foreground">
            projectLC · loot council tracker for TBC · wishlists via SixtyUpgrades · loot via Gargul or by hand
          </footer>
          <FeedbackWidget />
        </TooltipProvider>
      </body>
    </html>
  );
}
