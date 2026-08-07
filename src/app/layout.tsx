import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getRepo } from "@/lib/data/repo";
import { Nav } from "@/components/nav";
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
  const [guild, demand] = await Promise.all([repo.getGuild(), repo.listItemDemand()]);
  // Slim copy for the nav's instant item lookup (guild scale: a few hundred rows).
  const searchItems = demand.map((d) => ({
    itemId: d.itemId,
    name: d.name,
    quality: d.quality,
    icon: d.icon,
    slot: d.slot,
    wisherCount: d.wisherCount,
    openCount: d.openCount,
    awardCount: d.awardCount,
  }));
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
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <WowheadScripts />
        <WowheadRefresher />
        <TooltipProvider delayDuration={200}>
          <Nav
            guildName={guild.name}
            realm={guild.realm}
            activePhase={guild.activePhase}
            searchItems={searchItems}
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
